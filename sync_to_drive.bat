@echo off
setlocal

rem Append a dot so the source path does not end in a backslash before its quote.
set "SOURCE=%~dp0."
set "DEST=G:\My Drive\WonderNest"

if not exist "%DEST%\" mkdir "%DEST%"
if errorlevel 1 (
  echo Could not create destination folder: "%DEST%"
  exit /b 1
)

echo Copying WonderNest files to Google Drive...
echo Source:      "%SOURCE%"
echo Destination: "%DEST%"
echo Database files in the source are excluded. Any database already at the destination will be left untouched.

robocopy "%SOURCE%" "%DEST%" /E /COPY:DAT /DCOPY:DAT /R:2 /W:2 /XF database.db database.db-wal database.db-shm database.db-journal "database.db.reset-*"
set "COPY_RESULT=%ERRORLEVEL%"

if %COPY_RESULT% GEQ 8 (
  echo.
  echo Copy failed. Robocopy exit code: %COPY_RESULT%
  exit /b %COPY_RESULT%
)

echo.
echo Copy complete. Robocopy exit code: %COPY_RESULT%
echo The destination database was not overwritten.
exit /b 0
