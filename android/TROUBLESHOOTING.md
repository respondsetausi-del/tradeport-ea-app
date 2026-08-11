# Troubleshooting: "Connection Closed or Not Established" Error

## Summary of Changes Made
All references to RazorMarkets have been successfully replaced with AccuMarkets:
- Server name: **AccuMarkets-Live**
- WebTerminal URL: **https://webterminal.accumarkets.co.za/terminal**

## Common Causes of Connection Errors

### 1. **Invalid Credentials**
The most common cause is incorrect login credentials for the AccuMarkets server.

**Solution:**
- Verify your MT5 login number (e.g., 3004490)
- Double-check your password
- Ensure your account is registered with **AccuMarkets**, not RazorMarkets
- Contact AccuMarkets support to verify your account is active

### 2. **Server URL Issues**
The server URL may be incorrect or the server may be down.

**Solution:**
- Verify the correct URL is: `https://webterminal.accumarkets.co.za/terminal`
- Try accessing this URL in your phone's browser to see if it loads
- If the URL doesn't load, contact AccuMarkets to get the correct WebTerminal URL

### 3. **Network/Firewall Issues**
Your network or firewall may be blocking the connection.

**Solution:**
- Ensure you have a stable internet connection
- Try switching between WiFi and mobile data
- Check if your network/firewall blocks trading platforms
- Try on a different network

### 4. **SSL Certificate Issues**
The server's SSL certificate may have issues.

**Solution:**
- The app now provides detailed SSL error messages
- If you see SSL errors, contact AccuMarkets support
- DO NOT disable SSL verification (security risk)

### 5. **Server Name Mismatch**
If your account was created on a different server name.

**Solution:**
- AccuMarkets may use different server names like:
  - AccuMarkets-Live
  - AccuMarkets-Demo
  - AccuMarkets-Real
- Contact AccuMarkets to confirm your exact server name

## Enhanced Error Reporting

The app now provides detailed error messages:

| Error Code | Meaning | Action |
|------------|---------|--------|
| -2 | Server not found | Check URL and internet connection |
| -6 | Connection refused | Server may be down or blocking connections |
| -8 | Connection timeout | Slow network or server not responding |
| -15 | Connection closed | Server terminated the connection |
| SSL Error | Certificate issue | Contact AccuMarkets support |

## Testing Steps

### Step 1: Test the WebTerminal URL
1. Open your phone's browser
2. Navigate to: `https://webterminal.accumarkets.co.za/terminal`
3. Try to login with your credentials
4. If it works in browser but not in app, there may be a WebView compatibility issue

### Step 2: Check App Logs
1. Connect your phone to a computer
2. Run: `adb logcat | grep MT5Connection`
3. Look for detailed error messages that show exactly what's failing

### Step 3: Verify Account Details
1. Contact AccuMarkets support: [support email/phone]
2. Verify:
   - Your account number
   - Your account is active
   - The correct server name
   - The correct WebTerminal URL

### Step 4: Test with Demo Account
1. If available, try with an AccuMarkets demo account first
2. This will help isolate if the issue is with the account or the connection

## Additional Information

### WebView Requirements
The app uses Android WebView to load the MT5 WebTerminal. Requirements:
- Android WebView should be updated to the latest version
- JavaScript must be enabled (already configured in the app)
- Cookies must be enabled (already configured in the app)

### Contact AccuMarkets Support
If the issue persists, contact AccuMarkets support with:
1. Your account number
2. The exact error message from the app
3. Screenshot of the error
4. Ask them to verify:
   - Your account is active
   - The correct WebTerminal URL
   - If they have any server-side restrictions

### Alternative Server Names
If "AccuMarkets-Live" doesn't work, you may need to update the app to use a different server name. Common variations:
- AccuMarkets-Live01
- AccuMarkets-Live02
- AccuMarkets-Real
- AccuMarkets-Demo

To change the server name, update these files:
1. `MetatraderFragment.kt` - Line 99, 123, 163, 206, 219, 381
2. `TradeActivity.kt` - Line 389, 491
3. `fragment_metatrader.xml` - Line 182

## Quick Fix Checklist

- [ ] Internet connection is working
- [ ] Tried both WiFi and mobile data
- [ ] Verified login credentials with AccuMarkets
- [ ] Confirmed account is active
- [ ] WebTerminal URL loads in browser
- [ ] Android WebView is updated
- [ ] Checked app logs for specific error codes
- [ ] Contacted AccuMarkets support

## Success Indicators

When the connection is successful, you should see:
1. ✅ Green circle indicator showing "ACCOUNT CONNECTED"
2. Toast message: "Login Successful"
3. The WebView will show the MT5 terminal interface
4. You can see your account balance and symbols

## Need More Help?

If you've tried all the above and still have issues:
1. Check the app logs using `adb logcat`
2. Share the specific error code/message
3. Verify the exact URL AccuMarkets provides for their WebTerminal
4. Consider if AccuMarkets has any specific requirements or restrictions for WebTerminal access



