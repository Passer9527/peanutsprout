/**
 * 测试专用包含文件 —— **不随产品发布**，产品配置指向的是 installer.nsh。
 *
 * 目的：让 Windows 安装包能在 wine 下真正把安装流程跑完，从而验证
 * installer.nsh 里自定义的「快捷方式创建 / 卸载清理」逻辑。
 *
 * 为什么需要这个旁路：
 *   electron-builder 用 PowerShell + Get-CimInstance 检测"应用是否正在运行"。
 *   wine 的 PowerShell 对可用性探测**错误地返回 0**（谎报 Get-CimInstance 可用），
 *   于是走 CIM 分支，而 wine 并未实现 CIM，安装程序反复重试后以退出码 2 中止。
 *   这已由对照实验证实：**完全不含本仓库自定义脚本**的原版 electron-builder
 *   安装包在本机 wine 下失败方式完全相同（退出码 2、10 次 powershell、0 文件）。
 *   所以那是 wine 的缺陷，不是安装脚本的问题。
 *
 * 本文件把「应用是否在运行」这一步换成空操作。之所以不用
 *   `!insertmacro _CHECK_APP_RUNNING` 复用原逻辑：它第一行是
 *   `${GetProcessInfo}`，而该宏所在的 getProcessInfo.nsh 并非在所有分支下都被包含，
 *   在自定义分支里会直接 `Error in macro _CHECK_APP_RUNNING on macroline 1`。
 *   （这一步检测的是 electron-builder 自己的"应用在运行就先关掉"行为，
 *   与本次要验证的快捷方式逻辑无关，跳过它不影响验证结论。）
 *
 * 除上述一处外，安装包的其余逻辑与产品版**逐字相同** —— 因为下面直接 include
 *   了真正的 installer.nsh。
 *
 * 注：CHECK_APP_RUNNING 里的 `Var /GLOBAL CmdPath` / `PowerShellPath` 是无条件声明
 *   且无条件赋值的，所以即使走本空实现也不会触发 makensis 的 warning 6001
 *   （未引用变量，而 electron-builder 把 warning 当 error）。
 */

!macro customCheckAppRunning
  ; 空操作：让安装流程继续（wine 下没有需要关闭的真实应用进程）
!macroend

; 真正的产品脚本，一字不改地复用。
; 必须用 ${__FILEDIR__} 锚定，不能写成裸的 "installer.nsh"：
; electron-builder 会给 makensis 传 -I .../app-builder-lib/templates/nsis/include，
; 而那个目录下**也有**一个 installer.nsh（模板自己的），同名会被优先命中，
; 结果是产品脚本根本没被加载、模板文件被重复包含，报出一串
; "error in script: …/include/extractAppPackage.nsh on line 1"。
!include "${__FILEDIR__}\installer.nsh"
