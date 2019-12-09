import * as types from './types';
declare class Nexus {
    private mBaseData;
    private mBaseURL;
    private mQuota;
    private mValidationResult;
    private mRateLimit;
    constructor(appName: string, appVersion: string, defaultGame: string, timeout?: number);
    static create(apiKey: string, appName: string, appVersion: string, defaultGame: string, timeout?: number): Promise<Nexus>;
    setGame(gameId: string): void;
    getValidationResult(): types.IValidateKeyResponse;
    setKey(apiKey: string): Promise<types.IValidateKeyResponse>;
    getRateLimits(): {
        daily: number;
        hourly: number;
    };
    validateKey(key?: string): Promise<types.IValidateKeyResponse>;
    getTrackedMods(): Promise<types.ITrackedMod[]>;
    trackMod(modId: string, gameId?: string): Promise<types.ITrackResponse>;
    untrackMod(modId: string, gameId?: string): Promise<types.ITrackResponse>;
    getGames(): Promise<types.IGameListEntry[]>;
    getLatestAdded(gameId?: string): Promise<types.IModInfo[]>;
    getLatestUpdated(gameId?: string): Promise<types.IModInfo[]>;
    getTrending(gameId?: string): Promise<types.IModInfo[]>;
    getEndorsements(): Promise<types.IEndorsement[]>;
    getColourschemes(): Promise<types.IColourScheme[]>;
    getColorschemes(): Promise<types.IColourScheme[]>;
    getGameInfo(gameId?: string): Promise<types.IGameInfo>;
    getRecentlyUpdatedMods(period: types.UpdatePeriod, gameId?: string): Promise<types.IUpdateEntry[]>;
    endorseMod(modId: number, modVersion: string, endorseStatus: 'endorse' | 'abstain', gameId?: string): Promise<types.IEndorseResponse>;
    getModInfo(modId: number, gameId?: string): Promise<types.IModInfo>;
    getChangelogs(modId: number, gameId?: string): Promise<types.IChangelogs>;
    getModFiles(modId: number, gameId?: string): Promise<types.IModFiles>;
    getFileInfo(modId: number, fileId: number, gameId?: string): Promise<types.IFileInfo>;
    getDownloadURLs(modId: number, fileId: number, key?: string, expires?: number, gameId?: string): Promise<types.IDownloadURL[]>;
    getFileByMD5(hash: string, gameId?: string): Promise<types.IMD5Result[]>;
    sendCollection(manifest: types.ICollectionManifest, assetFilePath: string, gameId?: string): Promise<any>;
    getOwnIssues(): Promise<types.IIssue[]>;
    sendFeedback(title: string, message: string, fileBundle: string, anonymous: boolean, groupingKey?: string, id?: string): Promise<types.IFeedbackResponse>;
    private checkFileSize(filePath);
    private request(url, args, method?);
    private filter(obj);
    private args(customArgs);
}
export default Nexus;
