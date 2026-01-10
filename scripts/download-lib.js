// download-deps.js

// 适配新版依赖下载链接和命名，直接下载二进制文件，无需解压
const os = require("os");
const path = require("path");
const fs = require("fs");
const https = require("https");


// 通过 GitHub API 获取 release 版本
const GITHUB_API = "https://api.github.com/repos";
const PTY_REPO = "MCSManager/PTY";
const ZIPTOOLS_REPO = "MCSManager/Zip-Tools";

function fetchLatestReleaseTag(repo) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': 'Node.js',
                'Accept': 'application/vnd.github.v3+json'
            }
        };
        https.get(`${GITHUB_API}/${repo}/releases/latest`, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) return reject(new Error(`Failed to fetch release: ${repo}`));
                try {
                    const json = JSON.parse(data);
                    resolve(json.tag_name);
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

function getDownloadInfo() {
    const platform = os.platform();
    const arch = os.arch();
    // Keep platform → arch map explicit to avoid mismatched artifact names.
    const matrix = {
        linux: {
            x64: {
                ptyName: "pty_linux_x64",
                zip7z: "7z_linux_x64",
                zipFileZip: "file_zip_linux_x64"
            },
            arm64: {
                ptyName: "pty_linux_arm64",
                zip7z: "7z_linux_arm64",
                zipFileZip: "file_zip_linux_arm64"
            }
        },
        darwin: {
            x64: {
                ptyName: "pty_macos_x64",
                zip7z: "7z_macos_x64",
                zipFileZip: "file_zip_macos_x64"
            },
            arm64: {
                ptyName: "pty_macos_arm64",
                zip7z: "7z_macos_arm64",
                zipFileZip: "file_zip_macos_arm64"
            }
        },
        // Windows release assets currently only include the win32 naming scheme.
        win32: {
            x64: {
                ptyName: "pty_win32_x64.exe",
                zip7z: "7z_win32_x64.exe",
                zipFileZip: "file_zip_win32_x64.exe"
            }
        }
    };

    const byPlatform = matrix[platform];
    const info = byPlatform ? byPlatform[arch] : null;
    if (!info) {
        const supported = Object.entries(matrix)
            .map(([p, archMap]) => `${p}: [${Object.keys(archMap).join(", ")}]`)
            .join("; ");
        throw new Error(`Unsupported platform/arch: ${platform}/${arch}. Supported: ${supported}`);
    }
    return info;
}

function download(url, dest, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
        if (maxRedirects < 0) return reject(new Error('Too many redirects'));
        const options = {
            headers: {
                'User-Agent': 'Node.js'
            }
        };
        const file = fs.createWriteStream(dest, { mode: 0o755 });
        https.get(url, options, (res) => {
            // handle redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const next = new URL(res.headers.location, url).toString();
                res.destroy();
                return resolve(download(next, dest, maxRedirects - 1));
            }
            if (res.statusCode !== 200) {
                // collect small body for debug
                let body = '';
                res.on('data', c => body += c.toString());
                res.on('end', () => {
                    file.close();
                    try { fs.unlinkSync(dest); } catch (e) { }
                    const msg = `Failed to download: ${url} (status: ${res.statusCode})`;
                    console.error(msg, { statusCode: res.statusCode, headers: res.headers, body: body.slice(0, 200) });
                    return reject(new Error(msg));
                });
                return;
            }
            res.pipe(file);
            file.on("finish", () => file.close(resolve));
        }).on("error", (err) => {
            try { file.close(); fs.unlinkSync(dest); } catch (e) { }
            reject(err);
        });
    });
}


async function main() {
    const { ptyName, zip7z, zipFileZip } = getDownloadInfo();
    const depsDir = path.resolve(__dirname, "../daemon/lib");
    if (!fs.existsSync(depsDir)) fs.mkdirSync(depsDir, { recursive: true });

    // PTY 直接用 latest
    const ptyUrl = `https://github.com/MCSManager/PTY/releases/download/latest/${ptyName}`;
    const ptyFile = path.join(depsDir, ptyName);
    console.log("Downloading PTY:", ptyUrl);
    try {
        await download(ptyUrl, ptyFile);
    } catch (e) {
        console.error("Failed to download PTY:", e.message);
    }

    // Zip-Tools 依然获取最新 tag
    console.log("Fetching latest Zip-Tools release...");
    let zipTag = null;
    try {
        zipTag = await fetchLatestReleaseTag(ZIPTOOLS_REPO);
        console.log("Zip-Tools latest tag:", zipTag);
    } catch (e) {
        console.error("Failed to fetch Zip-Tools release tag:", e.message);
    }

    if (zipTag) {
        // Zip-Tools 7z
        const zip7zUrl = `https://github.com/MCSManager/Zip-Tools/releases/download/${zipTag}/${zip7z}`;
        const zip7zFile = path.join(depsDir, zip7z);
        console.log("Downloading Zip-Tools 7z:", zip7zUrl);
        try {
            await download(zip7zUrl, zip7zFile);
        } catch (e) {
            console.error("Failed to download Zip-Tools 7z:", e.message);
        }

        // Zip-Tools file_zip
        const zipFileZipUrl = `https://github.com/MCSManager/Zip-Tools/releases/download/${zipTag}/${zipFileZip}`;
        const zipFileZipFile = path.join(depsDir, zipFileZip);
        console.log("Downloading Zip-Tools file_zip:", zipFileZipUrl);
        try {
            await download(zipFileZipUrl, zipFileZipFile);
        } catch (e) {
            console.error("Failed to download Zip-Tools file_zip:", e.message);
        }
    }

    console.log("All dependencies download attempts finished. See above for any errors.");
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});