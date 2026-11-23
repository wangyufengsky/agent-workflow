package example.rates;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;

public class CatalogProbe {
    public static void main(String[] args) throws IOException {
        int port = Integer.parseInt(System.getenv("PORT"));
        HttpServer http = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        http.createContext("/system/ping", exchange -> {
            try (exchange) {
                exchange.sendResponseHeaders(204, -1);
            }
        });
        http.createContext("/v1/rate", CatalogProbe::quote);
        http.start();
        System.out.println("rate service listening on " + http.getAddress().getPort());
    }

    private static void quote(HttpExchange exchange) throws IOException {
        byte[] body = "{\"rate\":23,\"currency\":\"CNY\"}".getBytes(StandardCharsets.UTF_8);
        try (exchange) {
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
        }
    }
}
