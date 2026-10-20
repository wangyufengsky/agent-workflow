package inventory;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/** Stock levels per SKU. */
public final class Inventory {
    private final Map<String, Integer> stock = new TreeMap<>();

    public void add(String sku, int quantity) {
        if (quantity <= 0) throw new IllegalArgumentException("quantity must be positive");
        stock.merge(sku, quantity, Integer::sum);
    }

    /** Takes items out of stock; fails when there are not enough. */
    public void remove(String sku, int quantity) {
        if (quantity <= 0) throw new IllegalArgumentException("quantity must be positive");
        int current = quantity(sku);
        if (current < quantity) throw new IllegalStateException("not enough " + sku);
        stock.put(sku, current - quantity);
    }

    public int quantity(String sku) {
        return stock.getOrDefault(sku, 0);
    }

    /** SKUs whose stock is at or below the threshold, in SKU order. */
    public List<String> lowStock(int threshold) {
        List<String> low = new ArrayList<>();
        for (Map.Entry<String, Integer> e : stock.entrySet()) {
            if (e.getValue() < threshold) low.add(e.getKey());
        }
        return low;
    }
}
