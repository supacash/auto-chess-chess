package io.github.supacash.autochess;

import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.util.HashMap;
import java.util.Map;

/**
 * The game's own engine is single-threaded WASM and needs nothing special. Fairy-Stockfish, kept so
 * the game can go back to it (a `fairy` build: src/engine/engineChoice.ts), needs a cross-origin-
 * isolated page (SharedArrayBuffer): set ISOLATE to true with a `fairy` build, and every file the app
 * serves itself gets the COOP/COEP headers that the dev server and coi-serviceworker provide on the web.
 */
public class MainActivity extends BridgeActivity {

    /** Send COOP/COEP headers: only for a `fairy` build (npm run build:fairy). */
    private static final boolean ISOLATE = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (ISOLATE) bridge.setWebViewClient(new IsolatedWebViewClient(bridge));
    }

    private static class IsolatedWebViewClient extends BridgeWebViewClient {

        IsolatedWebViewClient(Bridge bridge) {
            super(bridge);
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            WebResourceResponse response = super.shouldInterceptRequest(view, request);
            if (response == null) return null;
            Map<String, String> headers = new HashMap<>();
            if (response.getResponseHeaders() != null) headers.putAll(response.getResponseHeaders());
            headers.put("Cross-Origin-Opener-Policy", "same-origin");
            headers.put("Cross-Origin-Embedder-Policy", "require-corp");
            response.setResponseHeaders(headers);
            return response;
        }
    }
}
