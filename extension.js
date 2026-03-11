"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = require("vscode");
const fs = require("fs/promises");
const path = require("path");
const child_process_1 = require("child_process");
const https = require("https");
const os = require("os");
let statusBarItem;
let refreshCommand;
let enableExplorerDecorationsCommand;
let decorationsProvider;
let updateTimer = null;
let updateSequence = 0;
const EXPLORER_PROMPT_DISMISSED_KEY = 'fileLastUpdated.explorerDecorationsPromptDismissed';
const DEFAULT_GITHUB_TIMEOUT_MS = 4000;
function activate(context) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.name = 'File Last Modified';
    statusBarItem.command = 'fileLastUpdated.refresh';
    statusBarItem.color = new vscode.ThemeColor('descriptionForeground');
    context.subscriptions.push(statusBarItem);
    refreshCommand = vscode.commands.registerCommand('fileLastUpdated.refresh', async () => {
        decorationsProvider?.invalidateAll();
        await updateStatusBar();
    });
    context.subscriptions.push(refreshCommand);
    enableExplorerDecorationsCommand = vscode.commands.registerCommand('fileLastUpdated.enableExplorerDecorations', async () => {
        await enableExplorerDecorations();
    });
    context.subscriptions.push(enableExplorerDecorationsCommand);
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => {
        scheduleStatusBarUpdate();
    }));
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
        decorationsProvider?.invalidateUri(document.uri);
        scheduleStatusBarUpdate();
    }));
    context.subscriptions.push(vscode.workspace.onDidCreateFiles((event) => {
        for (const file of event.files) {
            decorationsProvider?.invalidateUri(file);
        }
        scheduleStatusBarUpdate();
    }));
    context.subscriptions.push(vscode.workspace.onDidDeleteFiles((event) => {
        for (const file of event.files) {
            decorationsProvider?.removeUri(file);
        }
        scheduleStatusBarUpdate();
    }));
    context.subscriptions.push(vscode.workspace.onDidRenameFiles((event) => {
        for (const file of event.files) {
            decorationsProvider?.removeUri(file.oldUri);
            decorationsProvider?.invalidateUri(file.newUri);
        }
        scheduleStatusBarUpdate();
    }));
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration('fileLastUpdated') &&
            !event.affectsConfiguration('explorer.decorations.badges') &&
            !event.affectsConfiguration('explorer.decorations.colors')) {
            return;
        }
        decorationsProvider?.invalidateAll();
        scheduleStatusBarUpdate();
    }));
    decorationsProvider = new FileAgeDecorationProvider();
    context.subscriptions.push(vscode.window.registerFileDecorationProvider(decorationsProvider));
    context.subscriptions.push(decorationsProvider);
    scheduleStatusBarUpdate();
    void promptToEnableExplorerDecorations(context);
}
exports.activate = activate;
function deactivate() {
    if (updateTimer) {
        clearTimeout(updateTimer);
        updateTimer = null;
    }
}
exports.deactivate = deactivate;
function scheduleStatusBarUpdate() {
    if (updateTimer) {
        clearTimeout(updateTimer);
    }
    updateTimer = setTimeout(() => {
        updateTimer = null;
        void updateStatusBar();
    }, 150);
}
async function updateStatusBar() {
    const sequence = ++updateSequence;
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') {
        statusBarItem.hide();
        return;
    }
    const filePath = editor.document.uri.fsPath;
    try {
        const lastUpdated = await resolveLastUpdated(filePath);
        if (sequence !== updateSequence) {
            return;
        }
        statusBarItem.text = `Last Modified: ${formatShortDateTime(lastUpdated.date)} ${lastUpdated.source.toUpperCase()}`;
        statusBarItem.color = getStatusBarColor(lastUpdated.daysSinceEdit);
        statusBarItem.tooltip = buildTooltip(lastUpdated);
        statusBarItem.show();
    }
    catch (error) {
        if (sequence !== updateSequence) {
            return;
        }
        statusBarItem.text = 'Last Modified: unavailable';
        statusBarItem.color = new vscode.ThemeColor('descriptionForeground');
        statusBarItem.tooltip = `Unable to resolve last modified time.\n${getErrorMessage(error)}\n\nClick to retry.`;
        statusBarItem.show();
    }
}
async function resolveLastUpdated(filePath, options = {}) {
    const includeGitHub = options.includeGitHub !== false;
    const stats = await fs.stat(filePath);
    const localDate = normalizeDate(stats.mtime);
    if (!localDate) {
        throw new Error(`Unable to read modified time for ${filePath}`);
    }
    const repoInfo = await getRepoInfo(filePath);
    if (!repoInfo) {
        return {
            date: localDate,
            source: 'Local',
            localDate,
            gitDate: null,
            githubDate: null,
            author: null,
            message: null,
            branch: null,
            daysSinceEdit: getDaysSince(localDate),
            details: 'No Git repository detected for this file.'
        };
    }
    const gitInfo = await getLocalGitCommitInfo(repoInfo);
    const githubInfo = includeGitHub ? await getGitHubCommitInfo(repoInfo) : { date: null, author: null, message: null };
    const gitDate = gitInfo.date;
    const githubDate = githubInfo.date;
    const selectedDate = pickMostRecentDate(localDate, gitDate, githubDate) ?? localDate;
    const selectedSource = getSourceLabel(selectedDate, { localDate, gitDate, githubDate });
    const selectedCommitInfo = selectedSource === 'GitHub'
        ? githubInfo
        : selectedSource === 'Git'
            ? gitInfo
            : { author: null, message: null };
    return {
        date: selectedDate,
        source: selectedSource,
        localDate,
        gitDate,
        githubDate,
        author: selectedCommitInfo.author,
        message: selectedCommitInfo.message,
        branch: repoInfo.branch,
        daysSinceEdit: getDaysSince(selectedDate),
        details: buildSourceDetails(repoInfo, localDate, gitDate, githubDate, selectedDate)
    };
}
async function getRepoInfo(filePath) {
    try {
        const directory = path.dirname(filePath);
        const repoRoot = (await execFileAsync('git', ['rev-parse', '--show-toplevel'], directory)).trim();
        const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
        const branch = (await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot)).trim();
        let githubRemote = null;
        try {
            const remoteUrl = (await execFileAsync('git', ['config', '--get', 'remote.origin.url'], repoRoot)).trim();
            githubRemote = parseGitHubRemote(remoteUrl);
        }
        catch {
            githubRemote = null;
        }
        return {
            repoRoot,
            relativePath,
            branch,
            githubRemote
        };
    }
    catch {
        return null;
    }
}
function parseGitHubRemote(remoteUrl) {
    if (!remoteUrl) {
        return null;
    }
    const match = remoteUrl.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/i);
    if (!match) {
        return null;
    }
    return {
        owner: match[1],
        repo: match[2]
    };
}
async function getLocalGitCommitInfo(repoInfo) {
    try {
        const stdout = await execFileAsync('git', ['log', '-1', '--format=%cI%n%an%n%s', '--', repoInfo.relativePath], repoInfo.repoRoot);
        if (!stdout.trim()) {
            return { date: null, author: null, message: null };
        }
        const [dateLine, authorLine, ...messageParts] = stdout.trim().split('\n');
        return {
            date: normalizeDate(dateLine),
            author: authorLine || null,
            message: messageParts.join('\n') || null
        };
    }
    catch {
        return { date: null, author: null, message: null };
    }
}
async function getGitHubCommitInfo(repoInfo) {
    if (!repoInfo.githubRemote || !getConfiguration().get('enableGitHub', true)) {
        return { date: null, author: null, message: null };
    }
    try {
        const response = await httpsGetJson(buildGitHubCommitUrl(repoInfo.githubRemote, repoInfo.relativePath), buildGitHubHeaders(), getGitHubTimeoutMs());
        const commit = Array.isArray(response) ? response[0] : null;
        return {
            date: normalizeDate(commit?.commit?.committer?.date || commit?.commit?.author?.date),
            author: commit?.commit?.author?.name || commit?.author?.login || null,
            message: commit?.commit?.message?.split('\n')[0]?.trim() || null
        };
    }
    catch {
        return { date: null, author: null, message: null };
    }
}
function buildGitHubCommitUrl(githubRemote, relativePath) {
    const pathParam = encodeURIComponent(relativePath);
    return `https://api.github.com/repos/${githubRemote.owner}/${githubRemote.repo}/commits?path=${pathParam}&page=1&per_page=1`;
}
function buildGitHubHeaders() {
    const token = getConfiguration().get('githubToken', '').trim();
    const headers = {
        'User-Agent': 'file-last-updated-extension',
        Accept: 'application/vnd.github+json'
    };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    return headers;
}
function getGitHubTimeoutMs() {
    const configured = getConfiguration().get('githubTimeoutMs', DEFAULT_GITHUB_TIMEOUT_MS);
    return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_GITHUB_TIMEOUT_MS;
}
function httpsGetJson(url, headers, timeoutMs) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, { headers }, (response) => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => {
                body += chunk;
            });
            response.on('end', () => {
                if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
                    try {
                        resolve(JSON.parse(body));
                    }
                    catch (error) {
                        reject(error);
                    }
                    return;
                }
                reject(new Error(`GitHub API request failed with status ${response.statusCode}`));
            });
        });
        request.setTimeout(timeoutMs, () => {
            request.destroy(new Error(`GitHub API request timed out after ${timeoutMs}ms`));
        });
        request.on('error', reject);
    });
}
function execFileAsync(command, args, cwd) {
    return new Promise((resolve, reject) => {
        (0, child_process_1.execFile)(command, args, {
            cwd,
            encoding: 'utf8',
            env: {
                ...process.env,
                LC_ALL: 'C',
                LANG: 'C'
            },
            maxBuffer: 1024 * 1024
        }, (error, stdout) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(stdout);
        });
    });
}
function buildTooltip(lastUpdated) {
    const lines = [
        `Last Modified: ${formatTooltipDate(lastUpdated.date)}`,
        `Days since edit: ${lastUpdated.daysSinceEdit}`,
        '',
        'Click this status bar item to refresh.'
    ];
    const sourceTimestamps = [
        ['Local', lastUpdated.localDate],
        ['Git', lastUpdated.gitDate]
    ];
    for (const [label, value] of sourceTimestamps) {
        lines.push(`${label}: ${value instanceof Date ? formatTooltipDate(value) : 'Unavailable'}`);
    }
    if (lastUpdated.author) {
        lines.push(`Author: ${lastUpdated.author}`);
    }
    if (lastUpdated.message) {
        lines.push(`Commit: ${lastUpdated.message}`);
    }
    if (lastUpdated.branch) {
        lines.push(`Branch: ${lastUpdated.branch}`);
    }
    lines.push(`Source: ${lastUpdated.source}`);
    if (lastUpdated.details) {
        lines.push('', lastUpdated.details);
    }
    return lines.join('\n');
}
function buildSourceDetails(repoInfo, localDate, gitDate, githubDate, selectedDate) {
    const parts = [];
    parts.push(`Local timestamp: ${localDate ? formatTooltipDate(localDate) : 'Unavailable'}`);
    parts.push(`Git timestamp: ${gitDate ? formatTooltipDate(gitDate) : 'Unavailable'}`);
    if (isSameMoment(selectedDate, githubDate)) {
        parts.push('Using GitHub because it is the newest available timestamp.');
    }
    else if (isSameMoment(selectedDate, gitDate)) {
        parts.push(githubDate
            ? 'Using local Git because it is newer than the GitHub timestamp.'
            : 'Using local Git because it is the newest available timestamp.');
    }
    else if (!repoInfo?.githubRemote && gitDate) {
        parts.push('This repository is not backed by GitHub. Using the newest local timestamp.');
    }
    else if (!githubDate && !gitDate) {
        parts.push('Git history was unavailable, so the local file timestamp is being used.');
    }
    else {
        parts.push('Using the local file timestamp because it is the newest available timestamp.');
    }
    return parts.join(os.EOL);
}
function getSourceLabel(selectedDate, dates) {
    if (isSameMoment(selectedDate, dates.githubDate)) {
        return 'GitHub';
    }
    if (isSameMoment(selectedDate, dates.gitDate)) {
        return 'Git';
    }
    return 'Local';
}
function pickMostRecentDate(...dates) {
    return dates
        .filter((date) => date instanceof Date && !Number.isNaN(date.getTime()))
        .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
}
function isSameMoment(left, right) {
    return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
}
function normalizeDate(value) {
    if (!value) {
        return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}
function getDaysSince(date) {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}
function formatShortDateTime(date) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        year: '2-digit',
        month: '2-digit',
        day: '2-digit',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short',
        timeZone: getConfiguration().get('timeZone', 'America/Los_Angeles')
    });
    const parts = formatter.formatToParts(date);
    const partMap = new Map(parts.map((part) => [part.type, part.value]));
    const month = partMap.get('month') ?? '00';
    const day = partMap.get('day') ?? '00';
    const year = partMap.get('year') ?? '00';
    const hour = partMap.get('hour') ?? '12';
    const minute = partMap.get('minute') ?? '00';
    const dayPeriod = partMap.get('dayPeriod') ?? '';
    const timeZoneName = partMap.get('timeZoneName') ?? '';
    return `${month}/${day}/${year} ${hour}:${minute} ${dayPeriod} ${timeZoneName}`.trim();
}
function formatTooltipDate(date) {
    const formatter = new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short',
        timeZone: getConfiguration().get('timeZone', 'America/Los_Angeles')
    });
    return formatter.format(date);
}
function getStatusBarColor(days) {
    if (days <= getGreenDays()) {
        return new vscode.ThemeColor('fileLastUpdated.ageGreen');
    }
    if (days <= getYellowDays()) {
        return new vscode.ThemeColor('fileLastUpdated.ageYellow');
    }
    return new vscode.ThemeColor('fileLastUpdated.ageRed');
}
function getGreenDays() {
    return getNumericConfigurationValue('greenDays', 14);
}
function getYellowDays() {
    const greenDays = getGreenDays();
    const yellowDays = getNumericConfigurationValue('yellowDays', 35);
    return yellowDays >= greenDays ? yellowDays : greenDays;
}
function getNumericConfigurationValue(key, fallback) {
    const value = getConfiguration().get(key);
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function getConfiguration() {
    return vscode.workspace.getConfiguration('fileLastUpdated');
}
function areExplorerLabelColorsEnabled() {
    return getConfiguration().get('colorizeExplorerLabels', true) === true;
}
function areExplorerDecorationsEnabled() {
    const explorerConfig = vscode.workspace.getConfiguration('explorer');
    const decorations = explorerConfig.get('decorations');
    if (!decorations || typeof decorations !== 'object') {
        return false;
    }
    const badgesEnabled = decorations.badges === true;
    const colorsEnabled = decorations.colors === true;
    if (!areExplorerLabelColorsEnabled()) {
        return badgesEnabled;
    }
    return badgesEnabled && colorsEnabled;
}
async function enableExplorerDecorations() {
    await vscode.workspace.getConfiguration().update('explorer.decorations.badges', true, vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration().update('explorer.decorations.colors', true, vscode.ConfigurationTarget.Global);
    decorationsProvider?.invalidateAll();
    scheduleStatusBarUpdate();
    void vscode.window.showInformationMessage('File Last Modified enabled Explorer badges and colors.');
}
async function promptToEnableExplorerDecorations(context) {
    if (areExplorerDecorationsEnabled()) {
        return;
    }
    if (context.globalState.get(EXPLORER_PROMPT_DISMISSED_KEY, false)) {
        return;
    }
    const enableLabel = 'Enable';
    const notNowLabel = 'Not Now';
    const selection = await vscode.window.showInformationMessage('File Last Modified uses Explorer decorations to show file age badges and colors. Enable Explorer decorations now?', enableLabel, notNowLabel);
    if (selection === enableLabel) {
        await enableExplorerDecorations();
        await context.globalState.update(EXPLORER_PROMPT_DISMISSED_KEY, true);
        return;
    }
    if (selection === notNowLabel) {
        await context.globalState.update(EXPLORER_PROMPT_DISMISSED_KEY, true);
    }
}
function getErrorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
class FileAgeDecorationProvider {
    constructor() {
        this.decorations = new Map();
        this.emitter = new vscode.EventEmitter();
        this.onDidChangeFileDecorations = this.emitter.event;
    }
    provideFileDecoration(uri) {
        if (uri.scheme !== 'file') {
            return;
        }
        return this.getDecoration(uri);
    }
    invalidateAll() {
        this.decorations.clear();
        this.emitter.fire(undefined);
    }
    invalidateUri(uri) {
        this.decorations.delete(uri.toString());
        this.emitter.fire(uri);
    }
    removeUri(uri) {
        this.decorations.delete(uri.toString());
        this.emitter.fire(uri);
    }
    dispose() {
        this.emitter.dispose();
    }
    async getDecoration(uri) {
        const key = uri.toString();
        const existing = this.decorations.get(key);
        if (existing) {
            return existing;
        }
        try {
            const lastUpdated = await resolveLastUpdated(uri.fsPath, { includeGitHub: false });
            return this.storeDecoration(uri, lastUpdated);
        }
        catch {
            try {
                const stats = await fs.stat(uri.fsPath);
                const localDate = normalizeDate(stats.mtime);
                if (!localDate) {
                    return;
                }
                return this.storeDecoration(uri, {
                    date: localDate,
                    source: 'Local',
                    localDate,
                    gitDate: null,
                    githubDate: null,
                    author: null,
                    message: null,
                    branch: null,
                    daysSinceEdit: getDaysSince(localDate),
                    details: 'Using local file metadata because Git data was unavailable.'
                });
            }
            catch {
                return;
            }
        }
    }
    storeDecoration(uri, lastUpdated) {
        const decoration = {
            badge: `${lastUpdated.daysSinceEdit}d`,
            tooltip: buildTooltip(lastUpdated)
        };
        if (areExplorerLabelColorsEnabled()) {
            decoration.color = getStatusBarColor(lastUpdated.daysSinceEdit);
        }
        this.decorations.set(uri.toString(), decoration);
        return decoration;
    }
}
