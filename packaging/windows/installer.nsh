; 花生苗数据库管理工具 - NSIS 自定义片段
; Copyright (C) 2025 飞哥 (微信 6731663)
; SPDX-License-Identifier: AGPL-3.0-or-later
;
; 由 apps/desktop/electron-builder.yml 的 `nsis.include` 引入（路径相对 buildResources）。
; 只做一件当前配置做不到的事：在**卸载完成**时明确告诉用户数据目录还在哪。
; 为什么不直接删数据：
;   本地库（peanutsprout.db）、主密钥（master.key）、审计日志都在
;   %USERPROFILE%\.peanutsprout 里。删除程序 ≠ 删除数据，误删主密钥会让
;   已有连接密文永久不可解。所以设计上保留数据，只做提示（PRD 明确要求）。
;
; 可用宏（electron-builder 注入）：PRODUCT_NAME / PRODUCT_FILENAME / VERSION / APP_GUID 等。
; 注意：宏体是文本插入，标签名必须全局唯一，这里统一加 peanutsprout_ 前缀。

!macro customUnInstall
  ; 静默卸载（uninstall.exe /S）下不弹窗，避免阻塞无人值守/企业分发脚本
  IfSilent peanutsprout_uninstall_done
  MessageBox MB_OK|MB_ICONINFORMATION "花生苗已卸载，但本地数据仍然保留：$\r$\n$\r$\n%USERPROFILE%\.peanutsprout$\r$\n$\r$\n其中包含连接配置（加密）、主密钥 master.key 与审计日志。$\r$\n如需彻底清理，请手动删除该目录。$\r$\n（注意：删除 master.key 后，历史备份中的密文将无法再解密。）"
  peanutsprout_uninstall_done:
!macroend

!macro customInstall
  ; 当前不需要额外写注册表或环境变量：数据目录由服务端首次启动时以 0700 创建。
  ; 保留本宏作为扩展点（将来若需文件关联 / 开机自启，在这里实现）。
!macroend
