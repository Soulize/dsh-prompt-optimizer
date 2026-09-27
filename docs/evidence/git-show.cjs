// 把 git 里的某个版本文件按原始字节导出（避免 PowerShell 重定向写成 UTF-16）。
// 用法：node evidence/git-show.cjs <repoDir> <rev:path> <outFile>
const fs = require('fs')
const { execFileSync } = require('child_process')
const [repo, spec, outFile] = process.argv.slice(2)
if (!repo || !spec || !outFile) { console.error('usage: git-show.cjs <repoDir> <rev:path> <outFile>'); process.exit(2) }
const buf = execFileSync('git', ['-C', repo, 'show', spec], { maxBuffer: 128 * 1024 * 1024 })
fs.writeFileSync(outFile, buf)
const head = buf.slice(0, 3).toString('hex')
console.log('wrote ' + outFile + '  bytes=' + buf.length + '  head=' + head + '  (efbbbf=bom, fffe=utf16)')
