package com.royalconstruct.drive;

import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

// This app just wraps the live production site (see server.url in
// capacitor.config.json) rather than bundling its own copy of the client,
// so a deploy should show up the next time the app is opened — same as
// refreshing a browser tab. Reloading on every resume (not just cold start)
// guarantees that: switching back to the app after it's been backgrounded
// re-fetches the current page instead of showing whatever was cached in
// memory from before.
public class MainActivity extends BridgeActivity {
  private boolean isFirstResume = true;

  @Override
  public void onResume() {
    super.onResume();
    if (isFirstResume) {
      isFirstResume = false;
      return;
    }
    WebView webView = (WebView) getBridge().getWebView();
    if (webView != null) {
      webView.reload();
    }
  }
}
