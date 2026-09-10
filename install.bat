@echo off
npm install
cd server
npm install
cd ..\web
npm install
cd ..
echo.
echo Done. Run: npm run dev
pause
