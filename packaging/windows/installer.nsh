; 花生苗数据库管理工具 - NSIS 自定义片段
; Copyright (C) 2025 飞哥 (微信 6731663)
; SPDX-License-Identifier: AGPL-3.0-or-later
;
; 由 apps/desktop/electron-builder.yml 的 `nsis.include` 引入（路径相对 buildResources）。
; electron-builder 把本文件放在生成脚本的**公共头部**（scriptGenerator.build() + installer.nsi），
; 即模板主体之前展开，所以这里定义的宏能被模板里的 !ifmacrodef 探测到。
;
; 本文件负责安装向导里的两件事：
;   1. 「选择安装位置」之后增加一页，让用户勾选是否创建桌面 / 开始菜单快捷方式；
;   2. 卸载时清理这些快捷方式，并提示数据目录仍然保留。
; （「可修改安装路径」由 electron-builder.yml 的 allowToChangeInstallationDirectory
;   配合 oneClick: false 提供，无需在此实现。）
;
; 为什么快捷方式要自己建：
;   electron-builder 的 createDesktopShortcut / createStartMenuShortcut 只有
;   "建" 和 "不建" 两种取值，没有"让用户选"。要提供选择就必须关掉它的自动创建
;   （配置里两个键都设为 false，模板据此定义 DO_NOT_CREATE_*_SHORTCUT）。
;   但同一个宏也让**卸载器**整段跳过快捷方式清理（见 uninstaller.nsh 的 !ifndef 判断），
;   所以下面的 customUnInstall 必须自己删——否则会留下卸载不掉的孤儿快捷方式。
;
; 可用宏（electron-builder 注入）：PRODUCT_NAME / PRODUCT_FILENAME / APP_ID /
;   APP_DESCRIPTION / SHORTCUT_NAME / APP_EXECUTABLE_FILENAME 等。
; 注意：宏体是纯文本插入，标签名必须全局唯一，本文件统一加 peanutsprout_ 前缀。

; nsDialogs.nsh 自带 include 保护（!ifndef NSDIALOGS_INCLUDED），重复引入无副作用；
; 它同时引入 LogicLib.nsh 与 WinMessages.nsh，${If} 与 ${BST_CHECKED} 都出自那里。
!include nsDialogs.nsh

; 勾选状态。必须是全局 Var：NSIS 的页面创建函数与离开函数之间不共享局部变量。
; 静默安装（/S）不执行任何向导页，这两个变量保持空串，
; customInstall 里按"默认都勾选"处理，与界面默认值保持一致。
;
; 整段包在 !ifndef BUILD_UNINSTALLER 里：生成卸载器的那一趟中，
; 引用这些变量的页面函数（见下方 customHeader）与 customInstall 都不参与编译，
; 变量本身若还留着，makensis 会报
;   warning 6001: Variable "..." not referenced or never set, wasting memory!
; 而 electron-builder 把 warning 当 error。守卫条件必须与引用方完全一致。
!ifndef BUILD_UNINSTALLER
  Var peanutsproutDesktopCheck
  Var peanutsproutStartMenuCheck
  ; 复选框控件句柄，同样需要在 create 与 leave 两个回调之间传递
  Var peanutsproutDesktopCheckbox
  Var peanutsproutStartMenuCheckbox
!endif

; 页面文案。中英并列：安装包含 zh_CN 与 en_US 两种语言，而自定义页不参与
; electron-builder 的 messages.yml 本地化机制，写死双语比只写中文更稳。
!define PEANUTSPROUT_SHORTCUT_PAGE_TITLE "选择快捷方式 / Shortcuts"
!define PEANUTSPROUT_SHORTCUT_PAGE_SUBTITLE "选择要创建快捷方式的位置 / Choose where to create shortcuts"
!define PEANUTSPROUT_SHORTCUT_PAGE_LABEL "请选择快捷方式的创建位置（安装路径可在上一步修改）："
!define PEANUTSPROUT_SHORTCUT_DESKTOP_LABEL "创建桌面快捷方式(&D) / Desktop shortcut"
!define PEANUTSPROUT_SHORTCUT_STARTMENU_LABEL "创建开始菜单快捷方式(&S) / Start Menu shortcut"

!macro customPageAfterChangeDir
  Page custom peanutsproutShortcutPageCreate peanutsproutShortcutPageLeave
!macroend

; ---------------------------------------------------------------------------
; 自定义页面的两个回调函数
; ---------------------------------------------------------------------------
; 为什么放在 customHeader 而不是本文件顶层：
;   本文件整体位于生成脚本的**公共头部**（scriptGenerator.build() + installer.nsi），
;   而 MUI2.nsh 是模板主体（installer.nsi 第 9 行）才引入的。NSIS 是单遍编译器，
;   Function 体内出现的 !insertmacro 会在**解析到该行时**立即展开 —— 头部阶段
;   MUI_HEADER_TEXT 尚未定义，直接报 "macro named MUI_HEADER_TEXT not found"。
;   customHeader 是模板主体顶层的挂载点（installer.nsi:46，位于 MUI2 与 addLangs 之后），
;   在这里定义才能用上 MUI 的宏。
;   页面声明（上面的 customPageAfterChangeDir）先于本宏展开，属于"先引用后定义"，
;   NSIS 在链接期才解析函数名，因此合法。
;
; 为什么整段包在 !ifndef BUILD_UNINSTALLER 里（这一条踩过坑）：
;   模板把**所有向导页**的声明包在 !ifndef BUILD_UNINSTALLER 中
;   （assistedInstaller.nsh 第 7 行开、第 82 行闭），而 customHeader 两趟都会展开。
;   于是生成卸载器的那一趟里页面不存在、函数却存在，makensis 报
;     warning 6010: install function "..." not referenced - zeroing code out
;   而 electron-builder 把 warning 当 error（checkMakensisOutput），构建直接失败。
;   加上守卫后，函数与页面的存在条件一致。
!macro customHeader
  !ifndef BUILD_UNINSTALLER
    Function peanutsproutShortcutPageCreate
    !insertmacro MUI_HEADER_TEXT "${PEANUTSPROUT_SHORTCUT_PAGE_TITLE}" "${PEANUTSPROUT_SHORTCUT_PAGE_SUBTITLE}"

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 24u "${PEANUTSPROUT_SHORTCUT_PAGE_LABEL}"
    Pop $1

    ${NSD_CreateCheckBox} 0 30u 100% 12u "${PEANUTSPROUT_SHORTCUT_DESKTOP_LABEL}"
    Pop $peanutsproutDesktopCheckbox
    ${NSD_SetState} $peanutsproutDesktopCheckbox ${BST_CHECKED}

    ${NSD_CreateCheckBox} 0 48u 100% 12u "${PEANUTSPROUT_SHORTCUT_STARTMENU_LABEL}"
    Pop $peanutsproutStartMenuCheckbox
    ${NSD_SetState} $peanutsproutStartMenuCheckbox ${BST_CHECKED}

    nsDialogs::Show
  FunctionEnd

  Function peanutsproutShortcutPageLeave
    ${NSD_GetState} $peanutsproutDesktopCheckbox $peanutsproutDesktopCheck
    ${NSD_GetState} $peanutsproutStartMenuCheckbox $peanutsproutStartMenuCheck
  FunctionEnd
  !endif
!macroend

; ---------------------------------------------------------------------------
; 安装：按勾选结果创建快捷方式
; ---------------------------------------------------------------------------
; $newDesktopLink / $newStartMenuLink 由模板的 setLinkVars 在安装前算好
;   $newDesktopLink   = $DESKTOP\${SHORTCUT_NAME}.lnk
;   $newStartMenuLink = $SMPROGRAMS[\${MENU_FILENAME}]\${SHORTCUT_NAME}.lnk
; 直接复用可保证与 electron-builder 的命名约定完全一致，避免两处各写一份路径而漂移。
!macro customInstall
  ; 静默安装不会执行向导页 → 变量为空 → 按"默认都创建"处理
  ${If} $peanutsproutDesktopCheck == ""
    StrCpy $peanutsproutDesktopCheck ${BST_CHECKED}
  ${EndIf}
  ${If} $peanutsproutStartMenuCheck == ""
    StrCpy $peanutsproutStartMenuCheck ${BST_CHECKED}
  ${EndIf}

  ; ---- 桌面 ----
  ${If} $peanutsproutDesktopCheck == ${BST_CHECKED}
    ; 升级场景：旧版本用的快捷方式名可能不同（历史名字写在注册表里），
    ; 先把它改名到新名字，免得用户桌面上出现两个花生苗图标。
    ${If} $oldDesktopLink != $newDesktopLink
    ${AndIf} ${FileExists} "$oldDesktopLink"
    ${AndIfNot} ${FileExists} "$newDesktopLink"
      Rename "$oldDesktopLink" "$newDesktopLink"
    ${EndIf}

    ${IfNot} ${FileExists} "$newDesktopLink"
      CreateShortCut "$newDesktopLink" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
    ${EndIf}
    ; 设置 AppUserModelID：不设的话，从快捷方式启动的窗口会被任务栏当成
    ; 与固定项无关的另一个程序，出现两个图标。
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${Else}
    ; 这次不勾选 → 新旧两个位置都清掉（删除不存在的文件是空操作）
    Delete "$newDesktopLink"
    ${If} $oldDesktopLink != $newDesktopLink
      Delete "$oldDesktopLink"
    ${EndIf}
  ${EndIf}

  ; ---- 开始菜单 ----
  ${If} $peanutsproutStartMenuCheck == ${BST_CHECKED}
    ; 若配置了 menuCategory，目标子目录可能还不存在，CreateShortCut 会静默失败
    !ifdef MENU_FILENAME
      CreateDirectory "$SMPROGRAMS\${MENU_FILENAME}"
    !endif

    ${If} $oldStartMenuLink != $newStartMenuLink
    ${AndIf} ${FileExists} "$oldStartMenuLink"
    ${AndIfNot} ${FileExists} "$newStartMenuLink"
      Rename "$oldStartMenuLink" "$newStartMenuLink"
    ${EndIf}

    ${IfNot} ${FileExists} "$newStartMenuLink"
      CreateShortCut "$newStartMenuLink" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
    ${EndIf}
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ${Else}
    Delete "$newStartMenuLink"
    ${If} $oldStartMenuLink != $newStartMenuLink
      Delete "$oldStartMenuLink"
    ${EndIf}
  ${EndIf}

  ; 通知资源管理器刷新，否则刚创建的快捷方式要等一会儿才出现在桌面/开始菜单里
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

; ---------------------------------------------------------------------------
; 卸载：清理快捷方式 + 告知数据目录位置
; ---------------------------------------------------------------------------
!macro customUnInstall
  ; 快捷方式是 customInstall 自己建的，而配置里的 DO_NOT_CREATE_*_SHORTCUT
  ; 让模板内建的清理逻辑整段跳过，所以这里必须自己删。
  ; $newDesktopLink / $newStartMenuLink 由卸载器的 setLinkVars 在调用本宏之前算好，
  ; 路径与安装时完全一致。
  WinShell::UninstShortcut "$newDesktopLink"
  Delete "$newDesktopLink"

  WinShell::UninstShortcut "$newStartMenuLink"
  Delete "$newStartMenuLink"

  ; 若配置了 menuCategory，顺手删掉空的分类目录（非空时 RMDir 会失败，属预期）
  !ifdef MENU_FILENAME
    RMDir "$SMPROGRAMS\${MENU_FILENAME}"
  !endif

  ; 为什么保留数据目录：本地库（peanutsprout.db）、主密钥（master.key）、审计日志
  ; 都在 %USERPROFILE%\.peanutsprout 里。删除程序 ≠ 删除数据，误删主密钥会让已有
  ; 连接密文永久不可解。所以设计上保留数据，只做提示（PRD 明确要求）。
  ;
  ; 静默卸载（uninstall.exe /S）下不弹窗，避免阻塞无人值守/企业分发脚本
  IfSilent peanutsprout_uninstall_done
  MessageBox MB_OK|MB_ICONINFORMATION "花生苗已卸载，但本地数据仍然保留：$\r$\n$\r$\n%USERPROFILE%\.peanutsprout$\r$\n$\r$\n其中包含连接配置（加密）、主密钥 master.key 与审计日志。$\r$\n如需彻底清理，请手动删除该目录。$\r$\n（注意：删除 master.key 后，历史备份中的密文将无法再解密。）"
  peanutsprout_uninstall_done:
!macroend
