-- Welche Migration wurde wann auf dieser Umgebung angewandt.
CREATE TABLE schema_migrations (
    filename   VARCHAR(190) NOT NULL,
    applied_at DATETIME     NOT NULL,
    PRIMARY KEY (filename)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
