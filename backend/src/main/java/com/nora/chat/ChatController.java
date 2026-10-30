package com.nora.chat;

import com.nora.auth.AuthPrincipal;
import com.nora.chat.ChatDtos.*;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/rooms/{code}/chat")
public class ChatController {

    private final ChatService chat;

    public ChatController(ChatService chat) {
        this.chat = chat;
    }

    @GetMapping("/conversations")
    public List<ConvDto> list(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code) {
        return chat.list(p, code);
    }

    @PostMapping("/conversations")
    @ResponseStatus(HttpStatus.CREATED)
    public ConvDto createGroup(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @RequestBody CreateGroup req) {
        return chat.createGroup(p, code, req);
    }

    @PostMapping("/dm")
    public ConvDto openDm(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @RequestBody OpenDm req) {
        return chat.openDm(p, code, req.userId());
    }

    @PatchMapping("/conversations/{id}")
    public ConvDto update(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id, @RequestBody UpdateGroup req) {
        return chat.updateGroup(p, code, id, req);
    }

    @DeleteMapping("/conversations/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id) {
        chat.deleteGroup(p, code, id);
    }

    @PostMapping("/conversations/{id}/members")
    public List<MemberDto> addMembers(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id, @RequestBody AddMembers req) {
        return chat.addMembers(p, code, id, req);
    }

    @DeleteMapping("/conversations/{id}/members/{userId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void removeMember(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id, @PathVariable UUID userId) {
        chat.removeMember(p, code, id, userId);
    }

    @PatchMapping("/conversations/{id}/members/{userId}")
    public List<MemberDto> setRole(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id, @PathVariable UUID userId, @RequestBody SetRole req) {
        return chat.setRole(p, code, id, userId, req.role());
    }

    @PatchMapping("/conversations/{id}/me")
    public ConvDto prefs(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id, @RequestBody Prefs req) {
        return chat.prefs(p, code, id, req);
    }

    @PostMapping("/conversations/{id}/read")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void read(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id) {
        chat.markRead(p, code, id);
    }

    @GetMapping("/conversations/{id}/messages")
    public List<MessageDto> messages(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id,
                                     @RequestParam(required = false) Instant before, @RequestParam(defaultValue = "50") int limit) {
        return chat.messages(p, code, id, before, limit);
    }

    @PostMapping("/conversations/{id}/messages")
    @ResponseStatus(HttpStatus.CREATED)
    public MessageDto send(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id, @RequestBody SendMessage req) {
        return chat.send(p, code, id, req);
    }

    @PatchMapping("/conversations/{id}/messages/{messageId}")
    public MessageDto edit(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id, @PathVariable UUID messageId, @RequestBody Edit req) {
        return chat.edit(p, code, id, messageId, req.text());
    }

    @DeleteMapping("/conversations/{id}/messages/{messageId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteMessage(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id, @PathVariable UUID messageId) {
        chat.deleteMessage(p, code, id, messageId);
    }

    @PostMapping("/conversations/{id}/messages/{messageId}/react")
    public MessageDto react(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id, @PathVariable UUID messageId, @RequestBody React req) {
        return chat.react(p, code, id, messageId, req.emoji());
    }
}
