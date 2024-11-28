ALTER TABLE alarm ADD COLUMN change_timestamps JSON;
CREATE TABLE alarm (
    id INT AUTO_INCREMENT PRIMARY KEY,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    sensor VARCHAR(255),
    sensor_state VARCHAR(255),
    acknowledgment_state VARCHAR(255),
    alarm_class VARCHAR(255),
    status VARCHAR(255),
    priority INT,
    message TEXT
);
