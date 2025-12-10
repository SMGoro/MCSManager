import fs from "fs-extra";
import os from "os";
import path from "path";
import { compress } from "../common/compress";
import { $t } from "../i18n";
import logger from "./log";
import Instance from "../entity/instance/instance";

// 使用动态导入避免类型冲突
const loadMinimatch = () => require("minimatch");

interface IBackupInfo {
  fileName: string;
  timestamp: number;
  size: number;
  instanceUuid: string;
  instanceName: string;
}

const BACKUP_RULE_FILES = {
  allow: ".backupallow",
  ignore: ".backupignore"
};

const DEFAULT_BACKUP_DIR = "data/InstanceBackup";

export default class InstanceBackupService {
  /**
   * 获取备份规则
   */
  private static async getBackupRules(
    instancePath: string,
    type: "allow" | "ignore"
  ): Promise<string[]> {
    try {
      const mcsmDirPath = path.join(instancePath, ".mcsm");
      const rulesFilePath = path.join(mcsmDirPath, BACKUP_RULE_FILES[type]);

      if (!fs.existsSync(rulesFilePath)) {
        return [];
      }

      const content = await fs.readFile(rulesFilePath, "utf-8");
      return content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#"));
    } catch (error) {
      return [];
    }
  }

  /**
   * 解析规则
   */
  private static parseRule(rule: string) {
    const trimmed = rule.trim();
    const negated = trimmed.startsWith("!");
    const pattern = negated ? trimmed.slice(1) : trimmed;
    return { pattern, negated };
  }

  /**
   * 匹配规则
   */
  private static matchRule(
    pattern: string,
    normalizedPath: string,
    minimatchLib: any
  ): boolean {
    if (!pattern) return false;

    const matchOptions = { dot: true } as const;
    let targetPath = normalizedPath;

    if (pattern.startsWith("/")) {
      targetPath = `/${normalizedPath}`;
    }

    if (pattern.endsWith("/")) {
      const dirPattern = pattern.slice(0, -1);

      if (
        minimatchLib(targetPath, dirPattern, matchOptions) ||
        minimatchLib(targetPath, `${dirPattern}/**`, matchOptions) ||
        targetPath.startsWith(`${dirPattern}/`)
      ) {
        return true;
      }

      return false;
    }

    const candidates = [pattern];
    if (pattern.endsWith("/*") && !pattern.endsWith("/**")) {
      candidates.push(`${pattern.slice(0, -1)}**`);
    }

    for (const candidate of candidates) {
      if (minimatchLib(targetPath, candidate, matchOptions)) {
        return true;
      }

      if (candidate === pattern) {
        const basename = pattern.startsWith("/")
          ? `/${path.basename(normalizedPath)}`
          : path.basename(normalizedPath);
        if (minimatchLib(basename, candidate)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 评估允许规则
   */
  private static evaluateAllowRules(
    normalizedPath: string,
    rules: string[],
    minimatchLib: any
  ): "allow" | "deny" | "no-match" {
    if (rules.length === 0) return "allow";

    let matched = false;
    let allowed = false;

    for (const rule of rules) {
      const { pattern, negated } = this.parseRule(rule);
      if (!pattern) continue;

      const isMatch = this.matchRule(pattern, normalizedPath, minimatchLib);

      if (!isMatch) continue;

      matched = true;

      if (negated) {
        allowed = false;
        continue;
      }

      allowed = true;
      break;
    }

    if (!matched) return "no-match";
    return allowed ? "allow" : "deny";
  }

  /**
   * 评估忽略规则
   */
  private static evaluateIgnoreRules(
    normalizedPath: string,
    rules: string[],
    minimatchLib: any
  ): boolean {
    if (rules.length === 0) return true;

    for (const rule of rules) {
      const { pattern, negated } = this.parseRule(rule);
      if (!pattern) continue;

      const isMatch = this.matchRule(pattern, normalizedPath, minimatchLib);

      if (!isMatch) continue;

      if (negated) {
        return true;
      }

      return false;
    }

    return true;
  }

  /**
   * 检查文件是否应该被备份
   */
  private static async shouldBackup(
    filePath: string,
    instancePath: string,
    allowRules: string[],
    ignoreRules: string[]
  ): Promise<boolean> {
    const relativePath = path.relative(instancePath, filePath);
    const normalizedPath = relativePath.replace(/\\/g, "/");

    // 永远不备份 .mcsm 目录
    if (normalizedPath.startsWith(".mcsm/") || normalizedPath === ".mcsm") {
      return false;
    }

    if (allowRules.length === 0 && ignoreRules.length === 0) {
      return true;
    }

    const minimatch = loadMinimatch();

    let allowResult: "allow" | "deny" | "no-match" = "no-match";
    if (allowRules.length > 0) {
      allowResult = this.evaluateAllowRules(normalizedPath, allowRules, minimatch);
      if (allowResult === "deny") {
        return false;
      }
    }

    if (ignoreRules.length > 0) {
      const ignoreResult = this.evaluateIgnoreRules(normalizedPath, ignoreRules, minimatch);
      if (!ignoreResult) {
        return false;
      }
    }

    if (allowRules.length > 0) {
      return allowResult === "allow";
    }

    return true;
  }

  /**
   * 递归收集需要备份的文件
   */
  private static async collectBackupFiles(
    dirPath: string,
    instancePath: string,
    allowRules: string[],
    ignoreRules: string[]
  ): Promise<string[]> {
    const files: string[] = [];

    const processDirectory = async (currentPath: string) => {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        
        if (await this.shouldBackup(fullPath, instancePath, allowRules, ignoreRules)) {
          if (entry.isDirectory()) {
            await processDirectory(fullPath);
          } else if (entry.isFile()) {
            files.push(fullPath);
          }
        }
      }
    };

    await processDirectory(dirPath);
    return files;
  }

  /**
   * 获取备份目录路径
   */
  private static getBackupDir(instance: Instance): string {
    const backupPath = instance.config.backupConfig?.backupPath;
    if (backupPath && path.isAbsolute(backupPath)) {
      return backupPath;
    }
    // 默认备份路径
    return path.join(process.cwd(), DEFAULT_BACKUP_DIR, instance.instanceUuid);
  }

  /**
   * 创建备份
   */
  public static async createBackup(instance: Instance): Promise<IBackupInfo> {
    try {
      const instancePath = instance.absoluteCwdPath();
      const backupDir = this.getBackupDir(instance);

      // 确保备份目录存在
      await fs.ensureDir(backupDir);

      // 检查实例是否正在运行，如果是冷备份则需要停止
      let wasRunning = instance.status() === Instance.STATUS_RUNNING;
      const useColdBackup = instance.config.backupConfig?.useColdBackup ?? true;
      if (useColdBackup && wasRunning) {
        logger.info(`[Backup] Stopping instance ${instance.instanceUuid} for cold backup`);

        // 停止实例 for cold backup
        await instance.execPreset("stop");

        // Wait for instance to fully stop (with timeout)
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Timeout waiting for instance to stop for cold backup")), 30000);
        });

        const stopPromise = new Promise((resolve) => {
          const onExit = () => {
            instance.removeListener("exit", onExit);
            resolve(true);
          };
          instance.on("exit", onExit);
        });

        try {
          await Promise.race([stopPromise, timeoutPromise]);
          logger.info(`[Backup] Instance ${instance.instanceUuid} stopped successfully for cold backup`);
        } catch (error) {
          logger.error(`[Backup] Failed to stop instance ${instance.instanceUuid} for cold backup:`, error);
          throw new Error(`Failed to stop instance for cold backup: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // 获取备份规则
      const allowRules = await this.getBackupRules(instancePath, "allow");
      const ignoreRules = await this.getBackupRules(instancePath, "ignore");

      // 收集需要备份的文件
      logger.info(`[Backup] Collecting files for instance ${instance.instanceUuid}`);
      const filesToBackup = await this.collectBackupFiles(
        instancePath,
        instancePath,
        allowRules,
        ignoreRules
      );

      if (filesToBackup.length === 0) {
        throw new Error($t("TXT_CODE_instance_backup.noFilesToBackup"));
      }

      // 生成备份文件名
      const timestamp = Date.now();
      const backupFileName = `backup_${instance.config.nickname}_${timestamp}.zip`;
      const backupFilePath = path.join(backupDir, backupFileName);

      logger.info(
        `[Backup] Creating backup for instance ${instance.instanceUuid}, files: ${filesToBackup.length}`
      );

      // Create a temporary directory to maintain the instance directory structure in the archive
      const tempBackupDir = path.join(os.tmpdir(), `mcsmanager_backup_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`);
      const instanceDirName = path.basename(instancePath);
      const tempInstanceDir = path.join(tempBackupDir, instanceDirName);

      try {
        // Create the temporary instance directory
        await fs.ensureDir(tempInstanceDir);

        // Create each file with hard links to preserve directory structure while being efficient
        const linkPromises = filesToBackup.map(async (file) => {
          const relativePath = path.relative(instancePath, file);
          const targetPath = path.join(tempInstanceDir, relativePath);

          // Ensure parent directory exists
          await fs.ensureDir(path.dirname(targetPath));

          // Create a hard link to the original file (more efficient than copying)
          try {
            await fs.link(file, targetPath);
          } catch (error) {
            // If hard linking fails (e.g., across different filesystems), fall back to copying
            if ((error as NodeJS.ErrnoException).code === 'EXDEV') {
              await fs.copyFile(file, targetPath);
            } else {
              throw error;
            }
          }
        });

        // Wait for all files to be linked/copied
        await Promise.all(linkPromises);

        // Now compress the temporary directory structure
        await compress(backupFilePath, [tempInstanceDir], instance.config.fileCode, path.dirname(tempInstanceDir));
      } finally {
        // Clean up temporary directory
        if (fs.pathExistsSync(tempBackupDir)) {
          await fs.remove(tempBackupDir);
        }
      }

      // 获取备份文件大小
      const stats = await fs.stat(backupFilePath);

      // 清理旧备份（如果设置了最大备份数量）
      await this.cleanupOldBackups(instance);

      const backupInfo: IBackupInfo = {
        fileName: backupFileName,
        timestamp,
        size: stats.size,
        instanceUuid: instance.instanceUuid,
        instanceName: instance.config.nickname
      };

      logger.info(
        `[Backup] Backup created successfully: ${backupFileName}, size: ${stats.size} bytes`
      );

      // 如果实例原本是运行的，现在重新启动它（仅适用于冷备份）
      if (useColdBackup && wasRunning) {
        logger.info(`[Backup] Restarting instance ${instance.instanceUuid} after cold backup`);
        setTimeout(async () => {
          try {
            await instance.execPreset("start");
            logger.info(`[Backup] Instance ${instance.instanceUuid} restarted successfully after cold backup`);
          } catch (error) {
            logger.error(`[Backup] Failed to restart instance ${instance.instanceUuid} after cold backup:`, error);
          }
        }, 1000); // Small delay to ensure backup is complete
      }

      return backupInfo;
    } catch (error: any) {
      logger.error(`[Backup] Failed to create backup for instance ${instance.instanceUuid}:`, error);
      throw new Error($t("TXT_CODE_instance_backup.createBackupFailed", { err: error.message }));
    }
  }

  /**
   * 清理旧备份
   */
  private static async cleanupOldBackups(instance: Instance): Promise<void> {
    const maxBackups = instance.config.backupConfig?.maxBackupCount;
    if (!maxBackups || maxBackups <= 0) return;

    const backupDir = this.getBackupDir(instance);
    if (!fs.existsSync(backupDir)) return;

    const backups = await this.listBackups(instance);
    
    // 按时间戳排序，最新的在前
    backups.sort((a, b) => b.timestamp - a.timestamp);

    // 删除超出数量的备份
    for (let i = maxBackups; i < backups.length; i++) {
      const backupPath = path.join(backupDir, backups[i].fileName);
      try {
        await fs.remove(backupPath);
        logger.info(`[Backup] Removed old backup: ${backups[i].fileName}`);
      } catch (error: any) {
        logger.error(`[Backup] Failed to remove old backup ${backups[i].fileName}:`, error);
      }
    }
  }

  /**
   * 列出所有备份
   */
  public static async listBackups(instance: Instance): Promise<IBackupInfo[]> {
    const backupDir = this.getBackupDir(instance);

    if (!fs.existsSync(backupDir)) {
      return [];
    }

    const files = await fs.readdir(backupDir);
    const backups: IBackupInfo[] = [];

    for (const file of files) {
      if (!file.endsWith(".zip")) continue;

      const filePath = path.join(backupDir, file);
      try {
        const stats = await fs.stat(filePath);
        
        // 从文件名提取时间戳
        const match = file.match(/backup_.*_(\d+)\.zip$/);
        const timestamp = match ? parseInt(match[1]) : stats.mtimeMs;

        backups.push({
          fileName: file,
          timestamp,
          size: stats.size,
          instanceUuid: instance.instanceUuid,
          instanceName: instance.config.nickname
        });
      } catch (error: any) {
        logger.error(`[Backup] Failed to get info for backup file ${file}:`, error);
      }
    }

    // 按时间戳降序排序
    backups.sort((a, b) => b.timestamp - a.timestamp);

    return backups;
  }

  /**
   * 删除备份
   */
  public static async deleteBackup(instance: Instance, fileName: string): Promise<void> {
    const backupDir = this.getBackupDir(instance);
    const backupPath = path.join(backupDir, fileName);

    // 安全检查：确保文件路径在备份目录内
    if (!backupPath.startsWith(backupDir)) {
      throw new Error($t("TXT_CODE_instance_backup.invalidBackupPath"));
    }

    if (!fs.existsSync(backupPath)) {
      throw new Error($t("TXT_CODE_instance_backup.backupNotFound"));
    }

    try {
      await fs.remove(backupPath);
      logger.info(`[Backup] Deleted backup: ${fileName}`);
    } catch (error: any) {
      logger.error(`[Backup] Failed to delete backup ${fileName}:`, error);
      throw new Error($t("TXT_CODE_instance_backup.deleteBackupFailed", { err: error.message }));
    }
  }

  /**
   * 获取备份文件路径
   */
  public static getBackupPath(instance: Instance, fileName: string): string {
    const backupDir = this.getBackupDir(instance);
    const backupPath = path.join(backupDir, fileName);

    // 安全检查：确保文件路径在备份目录内
    if (!backupPath.startsWith(backupDir)) {
      throw new Error($t("TXT_CODE_instance_backup.invalidBackupPath"));
    }

    if (!fs.existsSync(backupPath)) {
      throw new Error($t("TXT_CODE_instance_backup.backupNotFound"));
    }

    return backupPath;
  }

  /**
   * 恢复备份
   */
  public static async restoreBackup(instance: Instance, fileName: string): Promise<void> {
    const backupPath = this.getBackupPath(instance, fileName);
    const instancePath = instance.absoluteCwdPath();

    try {
      logger.info(`[Backup] Restoring backup ${fileName} for instance ${instance.instanceUuid}`);

      // 使用解压功能恢复备份 - 首先解压到临时目录 to check the structure
      const os = require("os");
      const tempRestoreDir = path.join(os.tmpdir(), `mcsmanager_restore_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`);

      try {
        // Create temporary directory
        await fs.ensureDir(tempRestoreDir);

        // Decompress to temporary directory first
        const { decompress } = require("../common/compress");
        await decompress(backupPath, tempRestoreDir, instance.config.fileCode);

        // Check what's in the temp directory after extraction
        const extractedItems = await fs.readdir(tempRestoreDir);

        if (extractedItems.length === 1) {
          // If there's only one item and it's a directory, it's likely the extra folder issue
          const firstItemPath = path.join(tempRestoreDir, extractedItems[0]);
          const firstItemStat = await fs.stat(firstItemPath);

          if (firstItemStat.isDirectory()) {
            // This is the extra folder case - move contents from the subdirectory to destination
            const sourceDir = firstItemPath;
            const destDir = instancePath;

            // Ensure destination directory exists
            await fs.ensureDir(destDir);

            // Move all contents from sourceDir to destDir
            const files = await fs.readdir(sourceDir);
            for (const file of files) {
              const sourceFilePath = path.join(sourceDir, file);
              const destFilePath = path.join(destDir, file);

              // Remove destination if it already exists
              if (await fs.pathExists(destFilePath)) {
                await fs.remove(destFilePath);
              }

              // Move the file/directory
              await fs.move(sourceFilePath, destFilePath, { overwrite: true });
            }
          } else {
            // Single file, move it directly
            const sourceFilePath = path.join(tempRestoreDir, extractedItems[0]);
            const destFilePath = path.join(instancePath, extractedItems[0]);
            await fs.move(sourceFilePath, destFilePath, { overwrite: true });
          }
        } else if (extractedItems.length > 1) {
          // Multiple items at root level, move all to destination
          for (const item of extractedItems) {
            const sourceItemPath = path.join(tempRestoreDir, item);
            const destItemPath = path.join(instancePath, item);

            // Remove destination if it already exists
            if (await fs.pathExists(destItemPath)) {
              await fs.remove(destItemPath);
            }

            // Move the item
            await fs.move(sourceItemPath, destItemPath, { overwrite: true });
          }
        }
        // If extractedItems.length === 0, nothing to do

        logger.info(`[Backup] Backup restored successfully: ${fileName}`);
      } finally {
        // Clean up temporary directory
        if (await fs.pathExists(tempRestoreDir)) {
          await fs.remove(tempRestoreDir);
        }
      }
    } catch (error: any) {
      logger.error(`[Backup] Failed to restore backup ${fileName}:`, error);
      throw new Error($t("TXT_CODE_instance_backup.restoreBackupFailed", { err: error.message }));
    }
  }
}
