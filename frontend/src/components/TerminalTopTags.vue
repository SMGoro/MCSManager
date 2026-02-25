<script setup lang="ts">
import { t } from "@/lang/i18n";
import { useLocalStorage } from "@vueuse/core";
import {
  ApartmentOutlined,
  BlockOutlined,
  DashboardOutlined,
  HddOutlined
} from "@ant-design/icons-vue";
import prettyBytes, { type Options as PrettyOptions } from "pretty-bytes";
import { computed } from "vue";
import type { TagInfo } from "./interface";
import TerminalTags from "./TerminalTags.vue";
import { arrayFilter } from "../tools/array";

interface TerminalRuntimeInfo {
  cpuUsage?: number;
  memoryUsage?: number;
  memoryLimit?: number;
  memoryUsagePercent?: number;
  rxBytes?: number;
  txBytes?: number;
  storageUsage?: number;
  storageLimit?: number;
}

const props = defineProps<{
  info?: TerminalRuntimeInfo | null;
  isStopped: boolean;
}>();

const useByteUnit = useLocalStorage("useByteUnit", true); // true: bytes, false: bits
const prettyBytesConfig: PrettyOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  binary: true
};

const getUsageColor = (percentage?: number) => {
  percentage = Number(percentage);
  if (percentage > 600) return "error";
  if (percentage > 200) return "warning";
  return "default";
};

const formatMemoryUsage = (usage?: number, limit?: number) => {
  const fUsage = prettyBytes(usage ?? 0, prettyBytesConfig);
  const fLimit = prettyBytes(limit ?? 0, prettyBytesConfig);

  return limit ? `${fUsage} / ${fLimit}` : fUsage;
};

const formatNetworkSpeed = (bytes?: number) =>
  useByteUnit.value
    ? prettyBytes(bytes ?? 0, { ...prettyBytesConfig, binary: false }) + "/s"
    : prettyBytes((bytes ?? 0) * 8, { ...prettyBytesConfig, bits: true, binary: false }).replace(
        /bit$/,
        "b"
      ) + "ps";

const tags = computed<TagInfo[]>(() => {
  const info = props.info;
  if (!info || props.isStopped) return [];
  const {
    cpuUsage,
    memoryUsage,
    memoryLimit,
    memoryUsagePercent,
    rxBytes,
    txBytes,
    storageUsage,
    storageLimit
  } = info;

  return arrayFilter<TagInfo>([
    {
      label: t("TXT_CODE_b862a158"), // CPU Usage
      value: `${parseInt(String(cpuUsage))}%`,
      color: getUsageColor(cpuUsage),
      icon: BlockOutlined,
      condition: () => cpuUsage != null
    },
    {
      label: t("TXT_CODE_593ee330"), // Memory Usage
      value: formatMemoryUsage(memoryUsage, memoryLimit),
      color: getUsageColor(memoryUsagePercent),
      icon: DashboardOutlined,
      condition: () => memoryUsage != null
    },
    {
      label: t("TXT_CODE_DISK_USAGE"), // Disk Usage
      value: formatMemoryUsage(storageUsage, storageLimit),
      icon: HddOutlined,
      condition: () => storageUsage != null
    },
    {
      label: t("TXT_CODE_50daec4"), // Network Usage
      value: `↓${formatNetworkSpeed(rxBytes)} · ↑${formatNetworkSpeed(txBytes)}`,
      icon: ApartmentOutlined,
      condition: () => rxBytes != null || txBytes != null,
      onClick: () => {
        useByteUnit.value = !useByteUnit.value;
      }
    }
  ]);
});
</script>

<template>
  <TerminalTags :tags="tags" />
</template>
