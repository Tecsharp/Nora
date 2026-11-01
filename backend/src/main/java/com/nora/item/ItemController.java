package com.nora.item;

import com.nora.auth.AuthPrincipal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** API genérica de las herramientas de la sala; el contenido de cada una lo valida {@link ItemSchemas}. */
@RestController
public class ItemController {

    public record WriteRequest(Map<String, Object> data, Double sort) {}

    private final ItemService items;

    public ItemController(ItemService items) {
        this.items = items;
    }

    @GetMapping("/api/rooms/{code}/items/{tool}")
    public List<ItemService.ItemDto> list(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable String tool,
                                          @RequestParam(required = false) Instant before, @RequestParam(defaultValue = "200") int limit) {
        return items.list(p, code, tool, before, limit);
    }

    @PostMapping("/api/rooms/{code}/items/{tool}")
    @ResponseStatus(HttpStatus.CREATED)
    public ItemService.ItemDto create(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable String tool, @RequestBody WriteRequest req) {
        return items.create(p, code, tool, req.data(), req.sort());
    }

    @PatchMapping("/api/rooms/{code}/items/{tool}/{id}")
    public ItemService.ItemDto update(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable String tool, @PathVariable UUID id, @RequestBody WriteRequest req) {
        return items.update(p, code, tool, id, req.data(), req.sort());
    }

    @DeleteMapping("/api/rooms/{code}/items/{tool}/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable String tool, @PathVariable UUID id) {
        items.delete(p, code, tool, id);
    }

    @PostMapping("/api/rooms/{code}/items/{tool}/{id}/{action}")
    public ItemService.ItemDto act(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable String tool, @PathVariable UUID id,
                                   @PathVariable String action, @RequestBody(required = false) Map<String, Object> body) {
        return items.act(p, code, tool, id, action, body == null ? Map.of() : body);
    }

    /** Huecos ocupados de cada persona de la sala entre dos fechas (AAAA-MM-DD), para ver cuándo están libres. */
    @GetMapping("/api/rooms/{code}/availability")
    public Map<String, Object> availability(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @RequestParam String from, @RequestParam(required = false) String to) {
        return items.availability(p, code, from, to);
    }
}
