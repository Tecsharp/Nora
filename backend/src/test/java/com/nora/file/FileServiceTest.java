package com.nora.file;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class FileServiceTest {

    @Test
    void sanitizeStripsPathsAndControlChars() {
        assertEquals("passwd", FileService.sanitize("../../etc/passwd"));
        assertEquals("informe.pdf", FileService.sanitize("C:\\docs\\informe.pdf"));
        assertEquals("a.txt", FileService.sanitize("a\u0000.txt"));
        assertEquals("archivo", FileService.sanitize(".."));
        assertEquals("archivo", FileService.sanitize("   "));
        assertEquals("archivo", FileService.sanitize(null));
    }
}
