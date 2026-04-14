import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
	canDownloadBackupExport,
	getBackupExportStatusText,
} from "@/lib/backupExport";

const t = (value: string) => value;
const formatTimestamp = (value: string) => `fmt:${value}`;

test("getBackupExportStatusText formats completed backup details", () => {
	const text = getBackupExportStatusText(
		{
			status: "completed",
			filename: "lumina-backup-latest.zip",
			file_path: "/tmp/lumina-backup-latest.zip",
			file_size: 3 * 1024 * 1024,
			created_at: "2026-04-12T12:00:00+08:00",
			error_message: null,
			started_at: null,
			finished_at: null,
		},
		t,
		formatTimestamp,
	);

	assert.equal(
		text,
		"最新备份已生成：fmt:2026-04-12T12:00:00+08:00 · 3.0 MB",
	);
});

test("getBackupExportStatusText surfaces failure reason", () => {
	const text = getBackupExportStatusText(
		{
			status: "failed",
			filename: "lumina-backup-latest.zip",
			file_path: "/tmp/lumina-backup-latest.zip",
			file_size: null,
			created_at: null,
			error_message: "disk full",
			started_at: null,
			finished_at: "2026-04-12T12:05:00+08:00",
		},
		t,
		formatTimestamp,
	);

	assert.equal(text, "最近一次备份生成失败：disk full");
});

test("canDownloadBackupExport only allows completed jobs", () => {
	assert.equal(
		canDownloadBackupExport({
			status: "completed",
			filename: "lumina-backup-latest.zip",
			file_path: "/tmp/lumina-backup-latest.zip",
			file_size: 1,
			created_at: null,
			error_message: null,
			started_at: null,
			finished_at: null,
		}),
		true,
	);
	assert.equal(
		canDownloadBackupExport({
			status: "processing",
			filename: "lumina-backup-latest.zip",
			file_path: "/tmp/lumina-backup-latest.zip",
			file_size: null,
			created_at: null,
			error_message: null,
			started_at: "2026-04-12T12:00:00+08:00",
			finished_at: null,
		}),
		false,
	);
});

test("admin backup actions place download latest backup before generate backup", () => {
	const adminPageSource = fs.readFileSync(
		path.join(process.cwd(), "pages", "admin.tsx"),
		"utf8",
	);
	const backupSectionIndex = adminPageSource.indexOf("数据备份与恢复");
	const backupSectionSource = adminPageSource.slice(backupSectionIndex, backupSectionIndex + 6000);
	const downloadIndex = backupSectionSource.indexOf("下载最新备份");
	const generateIndex = backupSectionSource.indexOf("生成备份");
	const importIndex = backupSectionSource.lastIndexOf("导入备份");

	assert.notEqual(backupSectionIndex, -1);
	assert.notEqual(downloadIndex, -1);
	assert.notEqual(generateIndex, -1);
	assert.notEqual(importIndex, -1);
	assert.ok(downloadIndex < generateIndex);
	assert.ok(generateIndex < importIndex);
});
