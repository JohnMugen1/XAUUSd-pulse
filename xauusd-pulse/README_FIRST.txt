XAUUSD PULSE v2.0 (published by John Mugendi Kinyua) - HOW TO RUN

FIRST TIME
1. Install Node.js (LTS) from nodejs.org if you have not. Restart the PC if asked.
2. Right-click the zip, choose "Extract All", open the extracted folder.
   Use this NEW folder only. Do not copy files into an older one.
3. Double-click START.bat  (first run installs, about a minute).
   If Windows warns: More info, then Run anyway.
4. Your browser opens at http://127.0.0.1:3000
   Keep the black window open while you use it. Close it to stop.

REAL NUMBERS (free key) - NO FILE EDITING NEEDED
1. Sign up at twelvedata.com and copy your API key from the Dashboard.
2. On the dashboard, click "Settings" (top right), or use the yellow box if it is showing,
   paste the key and click "Save and use real data".
   OR double-click SET-KEY.bat, paste the key, press Enter, then double-click START.bat again.
3. Wait about 10 seconds. The yellow warning for candles disappears.
   The key is saved, so you only do this once.

STRATEGIES, ALERTS AND THE JOURNAL (new in v1.5)
Use the Strategy menu under the header to switch between 4 strategies. Everything below it follows your choice.
The Test lab card compares all four side by side (click a row to select one).
Alerts: the Alerts button (top right) shows messages from the platform. A green banner appears when a strategy
is GOOD TO GO (it passed the lab on two runs hours apart). Live BUY/SELL alerts appear only for strategies that pass.
GOOD TO GO means ready to try on a DEMO account. It is not a promise of profit.
The platform must be running (START.bat) to check and to show alerts.
Live signal journal: records every real signal from now on and its real outcome. This is the best proof over time.

TEST LAB (is the strategy's edge real or luck?)
Scroll to the "Test lab" card at the bottom, pick H1 or H4, click "Run test lab".
It takes a few seconds and gives a verdict plus year-by-year, unseen-data, settings and cost tests.

EVERY DAY AFTER
Just double-click START.bat.

IF START.bat WILL NOT RUN (manual way)
Click the address bar of this folder, type cmd, press Enter, then run:
   npm install
   npm start
and open http://127.0.0.1:3000

IF SOMETHING LOOKS WRONG
Send me the first 4 lines shown in the black window, and what
http://127.0.0.1:3000/api/status shows.
