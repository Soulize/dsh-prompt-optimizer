# 内置 Bash 运行时：出厂 Windows 线上抓到的两处缺陷（2026-09-24）

对象：`po06/runtime/`（插件自带 GNU bash/MSYS2 运行时，137 文件，43.6MB，manifest 逐文件 sha256）
入口：`bash` 工具（真机运行，非单元桩）
验收线（用户口径）：**出厂 Windows —— 无 WSL、无 Git、无 bash、无需管理员、无需重启 —— 装上即跑通**；命令按 WSL 习惯原样写。

## 缺陷 A：运行时没有 `/tmp`，重定向类命令直接失败

修前（真机原始输出）：

    $ printf 'b\na\nc\n' | sort | uniq | head -2
    a
    b
    [stderr] bash.exe: warning: could not find /tmp, please create!   ← 每条命令都带

    $ printf 'x\n' > /tmp/po06-t.txt && cat /tmp/po06-t.txt && rm -f /tmp/po06-t.txt
    【发生了什么】命令结束：退出码 1。
    [stderr] dsh-bash: line 1: /tmp/po06-t.txt: No such file or directory   ← 重定向硬失败

根因：payload 只搬了 `usr/bin`，MSYS 根下没有 `tmp/`。修法：建 `runtime/tmp`（含 `.keep`）。

## 缺陷 B：盘符方言是 `/cygdrive/c`，不是工具承诺的 `/c`（也不是 WSL 的 `/mnt/c`）

修前：

    $ head -1 /c/Users/WestFox/.dsh/po06.json
    head: cannot open '/c/Users/WestFox/.dsh/po06.json' for reading: No such file or directory
    $ cd /c/Users/WestFox/.dsh/plugins/dsh-prompt-optimizer
    dsh-bash: line 1: cd: /c/...: No such file or directory

同时环境里 `TEMP=/cygdrive/c/Users/...` —— 说明该运行时用的是 Cygwin 风格盘符。
而 `bash` 工具的描述写的是"盘符写作 /d/..." ⇒ **文档承诺与自带运行时不一致**，
模型按 WSL/Git-Bash 习惯写的 `/c/...`、`/d/...` 会全数落空。

根因：payload 缺挂载表 `/etc/fstab`，盘符前缀退回 cygdrive 默认。
修法：`runtime/etc/fstab` 同时给两种方言：

    none /cygdrive cygdrive binary,posix=0,noacl,user 0 0
    C:/ /c ntfs binary,posix=0,noacl,user 0 0

## 修后复验（同一入口，七类逐条）

| 类别 | 命令 | 结果 |
|---|---|---|
| 管道 | `printf 'b\na\nc\n' \| sort \| uniq \| head -2` | `a\nb` exit 0 |
| 重定向 | `printf 'x\n' > /tmp/po06-t.txt && cat … && rm -f …` | `x` exit 0（修前 exit 1） |
| `&&`/`\|\|`/`;` | `false \|\| echo fallback; true && ok=1; echo "ok=$ok"` | `fallback\nok=1` exit 0 |
| `$VAR`+引号 | `V='hello world'; echo "[$V]"; echo "${V#hello }"` | `[hello world]\nworld` exit 0 |
| 通配符 | `cd /c/… && ls *.md \| head -3` | `CHANGELOG.md / README.en.md / README.md` exit 0（修前 cd 失败） |
| `/` 开头路径 | `head -1 /c/Users/WestFox/.dsh/po06.json` | `{` exit 0（修前 No such file） |
| 退出码 | `grep -q zzz-no-such /c/…; echo "exit=$?"` | `exit=1`，无 `/tmp` 警告 |
| 三种方言 | `/c/…`、`/cygdrive/c/…`、`C:/…` | 全部可读 |

清单一致性：补入 `etc/fstab`、`tmp/.keep` 两条后，137 条逐文件重算 sha256 —— **0 失配、0 缺失**。

## 未验证 / 未解决（不得写成已验证）

1. **没有在真正无 Git 的机器上跑过**。本机装有 Git for Windows（D:\other\Git）与 MSYS 环境，
   上面所有记录都只证明"自带运行时自身可用"，**不等于**出厂 Windows 已验证。
2. **`etc/fstab` 与 `tmp/` 是手工补进 payload 的**，仓库里没找到生成该 payload 的脚本
   ⇒ 重新刷 payload 会把这两项丢掉，缺陷 A/B 会静默回归。**需要把它们固化进生成脚本。**
3. `/tmp` 落在插件目录内：安装目录只读时不可写，需要回落到 per-user 数据目录。
4. 工具未回报"本次用的是哪个 runtime（env / bundled / Git / MSYS2 / PATH）"，
   当前只能靠间接特征判断（缺 cygpath、带 /tmp 警告）——可查性缺口。
