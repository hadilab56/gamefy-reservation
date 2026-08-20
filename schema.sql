-- ===================================================
-- Gamefy Academy — MariaDB / MySQL Schema (HeidiSQL)
-- ===================================================

CREATE DATABASE IF NOT EXISTS `gamefy_academy` 
  DEFAULT CHARACTER SET utf8mb4 
  COLLATE utf8mb4_unicode_ci;

USE `gamefy_academy`;

-- 1. Users Table
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `username` VARCHAR(50) NOT NULL UNIQUE,
  `password` VARCHAR(255) NOT NULL,
  `displayName` VARCHAR(100) DEFAULT '',
  `role` ENUM('admin', 'staff') DEFAULT 'admin',
  `createdAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Reservations Table
CREATE TABLE IF NOT EXISTS `reservations` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(100) NOT NULL,
  `phone` VARCHAR(50) DEFAULT '',
  `date` DATE NOT NULL,
  `arrivalTime` VARCHAR(10) NOT NULL,
  `leavingTime` VARCHAR(10) DEFAULT '',
  `duration` VARCHAR(50) DEFAULT '',
  `stations` LONGTEXT DEFAULT NULL,
  `stationType` ENUM('pc', 'vip') DEFAULT 'pc',
  `notes` TEXT DEFAULT NULL,
  `status` ENUM('pending', 'confirmed', 'active', 'done', 'cancelled') DEFAULT 'pending',
  `createdAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_date` (`date`),
  INDEX `idx_status` (`status`),
  INDEX `idx_date_status` (`date`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Sessions Table (for Express session store)
CREATE TABLE IF NOT EXISTS `sessions` (
  `session_id` VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  `expires` INT(11) UNSIGNED NOT NULL,
  `data` MEDIUMTEXT COLLATE utf8mb4_bin,
  PRIMARY KEY (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
