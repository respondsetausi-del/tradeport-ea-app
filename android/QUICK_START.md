# Quick Start Guide - AccuMarkets Connection

## ⚡ Quick Testing Steps

### 1. Build the App
```bash
cd /Users/justvino__/Desktop/Development/eaconverter/tradeportea
./gradlew assembleRelease
```
APK location: `app/release/tradeportea.apk`

### 2. Test the Connection
1. Install the APK on your device
2. Open the app
3. Navigate to "METATRADER" section
4. You'll see the server field already set to: **AccuMarkets-Live**
5. Enter your login number (e.g., 3004490)
6. Enter your password
7. Click "LINK MT5 ACCOUNT DETAILS"

### 3. What to Expect

#### ✅ Success Scenario:
1. Toast: "Connecting to AccuMarkets..."
2. Toast: "Logging in Details"
3. Toast: "Login Successful"
4. **Green circle** indicator appears
5. WebView shows MT5 terminal

#### ❌ Failure Scenarios:

**No Internet:**
- Toast: "No internet connection. Please check your network."
- Red circle indicator
- **Fix:** Enable WiFi/mobile data

**Connection Timeout:**
- Toast: "Connection failed. Retrying... (1/3)"
- Automatic retry up to 3 times
- **Fix:** Check network quality

**Server Not Found:**
- Toast: "Server not found. Verify URL with AccuMarkets support"
- Red circle indicator
- **Fix:** Contact AccuMarkets for correct URL

**Invalid Credentials:**
- WebView loads but login fails
- Toast: "Invalid Login or Password"
- Red circle indicator
- **Fix:** Verify credentials with AccuMarkets

---

## 🔍 Quick Diagnostics

### Problem: "Connection Closed" Error

**Step 1:** Test URL in browser
- Open: `https://webterminal.accumarkets.co.za/terminal`
- Can you load it? 
  - ✅ Yes → Credential or app issue
  - ❌ No → URL is wrong

**Step 2:** Check app logs
```bash
adb logcat | grep MT5Connection
```
Look for error codes:
- `-2` = URL/DNS problem
- `-8` = Timeout (slow network)
- `-15` = Server closed connection
- `404` = WebTerminal URL not found

**Step 3:** Verify with AccuMarkets
Contact AccuMarkets support and verify:
1. Your account number
2. Your password
3. The correct server name (might not be "AccuMarkets-Live")
4. The correct WebTerminal URL

---

## 📋 Quick Checklist

Before contacting support, verify:

- [ ] Internet connection is working (test other websites)
- [ ] Tried both WiFi and mobile data
- [ ] Account credentials are correct
- [ ] Account is active with AccuMarkets (not RazorMarkets)
- [ ] URL loads in phone browser
- [ ] Android WebView is updated (check Google Play Store)
- [ ] No VPN/firewall blocking connection

---

## 🆘 Common Error Messages

| Error Message | Likely Cause | Quick Fix |
|---------------|--------------|-----------|
| "No internet connection" | WiFi/data disabled | Enable internet |
| "Server not found" | Wrong URL or DNS | Verify URL with AccuMarkets |
| "Connection timeout" | Slow network | Try different network |
| "Connection closed" | Server terminated | Check credentials/server status |
| "Invalid Login or Password" | Wrong credentials | Verify with AccuMarkets |
| "SSL Error" | Certificate problem | Contact AccuMarkets support |
| "HTTP Error: 404" | Wrong URL | Get correct URL from AccuMarkets |

---

## 📞 AccuMarkets Support Info

When contacting AccuMarkets support, provide:

1. **Your account number:** (e.g., 3004490)
2. **Platform:** MT5
3. **Question:** "What is the correct WebTerminal URL and server name for my account?"
4. **Screenshots:** Show them the error message
5. **Logs:** Share output from `adb logcat | grep MT5Connection`

Questions to ask:
- ✅ Is my account active and approved?
- ✅ What is the exact WebTerminal URL I should use?
- ✅ What is the exact server name? (AccuMarkets-Live, AccuMarkets-Real, etc.)
- ✅ Are there any IP restrictions or firewall rules?
- ✅ Does the WebTerminal support Android WebView?

---

## 🔧 Advanced Troubleshooting

### Enable Developer Options on Android
1. Go to Settings → About Phone
2. Tap "Build Number" 7 times
3. Go back → Developer Options
4. Enable "USB Debugging"

### View Detailed Logs
```bash
# Connect phone to computer
adb devices

# View all logs
adb logcat

# View only MT5 connection logs
adb logcat | grep MT5Connection

# Save logs to file
adb logcat | grep MT5Connection > mt5_logs.txt
```

### Test WebView Update
1. Open Google Play Store
2. Search for "Android System WebView"
3. Update if available
4. Restart phone
5. Try connecting again

### Network Diagnostics
```bash
# Test if server is reachable
ping webterminal.accumarkets.co.za

# Check DNS resolution
nslookup webterminal.accumarkets.co.za

# Test with curl
curl -v https://webterminal.accumarkets.co.za/terminal
```

---

## ✨ New Features in This Version

1. **Auto-Retry:** Automatically retries failed connections 3 times
2. **Better Errors:** Shows specific error messages with solutions
3. **Network Check:** Verifies internet before attempting connection
4. **Modern WebView:** Updated to use latest Chrome user agent
5. **Fresh Connections:** No stale cache causing issues
6. **Comprehensive Logging:** Detailed logs for debugging
7. **HTTP Error Handling:** Shows status codes and meanings
8. **SSL Error Detection:** Identifies certificate issues

---

## 📖 More Information

- **Detailed Troubleshooting:** See `TROUBLESHOOTING.md`
- **Complete Changes:** See `CHANGES_SUMMARY.md`
- **Technical Details:** See `WEBVIEW_REBUILD.md`

---

## 🎯 Expected Outcome

With valid AccuMarkets credentials and a stable internet connection:
- **Connection should succeed in under 10 seconds**
- **Green circle indicator should appear**
- **MT5 WebTerminal should be visible and functional**
- **Login will be processed automatically**

If connection still fails after following this guide:
1. Save logs: `adb logcat | grep MT5Connection > logs.txt`
2. Test URL in browser and screenshot result
3. Contact AccuMarkets support with above information

---

**Good luck! The WebView has been completely rebuilt for reliability.** 🚀



