package inventory;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;
import org.junit.jupiter.api.Test;

class InventoryTest {
    @Test
    void addsAndRemovesStock() {
        Inventory inventory = new Inventory();
        inventory.add("apple", 5);
        inventory.add("apple", 3);
        inventory.remove("apple", 6);
        assertEquals(2, inventory.quantity("apple"));
    }

    @Test
    void refusesToRemoveMoreThanInStock() {
        Inventory inventory = new Inventory();
        inventory.add("pear", 1);
        assertThrows(IllegalStateException.class, () -> inventory.remove("pear", 2));
    }

    @Test
    void listsLowStockInSkuOrder() {
        Inventory inventory = new Inventory();
        inventory.add("b", 1);
        inventory.add("a", 2);
        inventory.add("c", 9);
        assertEquals(List.of("a", "b"), inventory.lowStock(3));
    }
}
