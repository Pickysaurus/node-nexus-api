import * as param from './parameters';
import * as types from './types';
import Quota from './Quota';

import * as fs from 'fs';
import request = require('request');
import format = require('string-template');
import { HTTPError, NexusError, RateLimitError, TimeoutError, ParameterInvalid } from './customErrors';

interface IRequestArgs {
  headers?: any;
  path?: any;
  data?: any;
  requestConfig?: {
    timeout: number,
    noDelay: boolean,
  };
  responseConfig?: {
    timeout: number,
  };
}

function handleRestResult(resolve, reject, url: string, error: any,
                          response: request.RequestResponse, body: any) {
  if (error !== null) {
    if ((error.code === 'ETIMEDOUT') || (error.code === 'ESOCKETTIMEOUT')) {
      return reject(new TimeoutError('request timed out: ' + url));
    }
    return reject(error);
  }

  try {
    if ((response.statusCode === 521)
        || (body === 'Bad Gateway')) {
      // in this case the body isn't something the api sent so it probably can't be parsed
      return reject(new NexusError('API currently offline', response.statusCode, url));
    }

    if (response.statusCode === 429) {
      // server asks us to slow down because rate limit was exceeded or high server load
      return reject(new RateLimitError());
    }

    if (response.statusCode === 202) {
      // server accepted our request but didn't produce a result in time (for an internal timeout).
      // As a result we simply don't know if the request was processed or not.
      // If it was a simple data query, this is the same as a timeout. If it was a query that
      // has a side effect (e.g. endorsing a mod) we don't know if it succeeded
      return reject(new TimeoutError('Not processed in time'));
    }

    const data = JSON.parse(body || '{}');

    if ((response.statusCode < 200) || (response.statusCode >= 300)) {
      return reject(new NexusError(data.message || data.error || response.statusMessage,
                                   response.statusCode, url));
    }

    resolve(data);
  } catch (err) {
    reject(new Error(`failed to parse server response for request "${url}": ${err.message}`));
  }
}

function restGet(url: string, args: IRequestArgs): Promise<any> {
  const stackErr = new Error();
  return new Promise<any>((resolve, reject) => {
    request.get(format(url, args.path || {}), {
      headers: args.headers,
      followRedirect: true,
      timeout: args.requestConfig.timeout,
    }, (error, response, body) => {
      if (error) {
        // if this error remains uncaught the error message won't be particularly
        // enlightening so we enhance it a bit
        error.message += ` (request: ${url})`;
        error.stack += '\n' + stackErr.stack;
      }

      handleRestResult(resolve, reject, url, error, response, body);
    });
  });
}

function restPost(url: string, args: IRequestArgs): Promise<any> {
  const stackErr = new Error();
  return new Promise<any>((resolve, reject) => {
    request.post({
      url: format(url, args.path),
      headers: args.headers,
      followRedirect: true,
      timeout: args.requestConfig.timeout,
      body: JSON.stringify(args.data),
    }, (error, response, body) => {
      if (error) {
        // if this error remains uncaught the error message won't be particularly
        // enlightening so we enhance it a bit
        error.message += ` (request: ${url})`;
        error.stack += '\n' + stackErr.stack;
      }
      handleRestResult(resolve, reject, url, error, response, body);
    });
  });
}

function rest(url: string, args: IRequestArgs): Promise<any> {
  return args.data !== undefined
    ? restPost(url, args)
    : restGet(url, args);
}

/**
 * Main class of the api
 *
 * @class Nexus
 */
class Nexus {
  private mBaseData: IRequestArgs;

  private mBaseURL = param.API_URL;
  private mQuota: Quota;
  private mValidationResult: types.IValidateKeyResponse;

  /**
   * Constructor
   * please don't use this directly, use Nexus.create
   * @param appVersion {string} Version number of the client application (Needs to be semantic format)
   * @param defaultGame {string} (nexus) id of the game requests are made for. Can be overridden per request
   * @param timeout {number} Request timeout in milliseconds. Defaults to 5000ms
   */
  constructor(appVersion: string, defaultGame: string, timeout?: number) {
    this.mBaseData = {
      headers: {
        'Content-Type': 'application/json',
        APIKEY: undefined,
        'Protocol-Version': param.PROTOCOL_VERSION,
        'Application-Version': appVersion,
      },
      path: {
        gameId: defaultGame,
      },
      requestConfig: {
        timeout: timeout || param.DEFAULT_TIMEOUT_MS,
        noDelay: true,
      },
      responseConfig: {
        timeout: timeout || param.DEFAULT_TIMEOUT_MS,
      },
    };

    this.mQuota = new Quota(param.QUOTA_MAX, param.QUOTA_MAX, param.QUOTA_RATE_MS);
  }

  /**
   * create a Nexus instance and immediately verify the API Key
   * 
   * @param apiKey the api key to use for connections
   * @param appVersion {string} Version number of the client application (Needs to be semantic format)
   * @param defaultGame {string} (nexus) id of the game requests are made for. Can be overridden per request
   * @param timeout {number} Request timeout in milliseconds. Defaults to 5000ms
   */
  public static async create(apiKey: string, appVersion: string, defaultGame: string, timeout?: number): Promise<Nexus> {
    const res = new Nexus(appVersion, defaultGame, timeout);
    res.mValidationResult = await res.setKey(apiKey);
    return res;
  }

  /**
   * change the default game id
   * @param gameId {string} game id
   */
  public setGame(gameId: string): void {
    this.mBaseData.path.gameId = gameId;
  }

  /**
   * retrieve the result of the last key validation.
   * This is useful primarily after creating the object with Nexus.create
   */
  public getValidationResult(): types.IValidateKeyResponse {
    return this.mValidationResult;
  }

  /**
   * change the API Key and validate it This can also be used to unset the key
   * @param apiKey the new api key to set
   * @returns A promise that resolves to the user info on success or null if the apikey was undefined
   */
  public async setKey(apiKey: string): Promise<types.IValidateKeyResponse> {
    this.mBaseData.headers.APIKEY = apiKey;
    if (apiKey !== undefined) {
      try {
        this.mValidationResult = await this.validateKey(apiKey);
        if (this.mBaseData.headers.APIKEY === apiKey) {
          this.mQuota.setMax(this.mValidationResult['is_premium?'] ? param.QUOTA_MAX_PREMIUM : param.QUOTA_MAX);
        }
        return this.mValidationResult;
      }
      catch (err) {
        this.mQuota.setMax(param.QUOTA_MAX);
        this.mValidationResult = null;
        throw err;
      }
    } else {
      this.mQuota.setMax(param.QUOTA_MAX);
      this.mValidationResult = null;
      return null;
    }
  }

  /**
   * validate a specific API key
   * This does not update the request quota or the cached validation result so it's
   * not useful for re-checking the key after a validation error.
   * @param key the API key to validate. Tests the current one if left undefined
   */
  public async validateKey(key?: string): Promise<types.IValidateKeyResponse> {
    await this.mQuota.wait();
    return this.request(this.mBaseURL + '/users/validate',
                this.args({ headers: this.filter({ APIKEY: key }) }));
  }

  /**
   * Endorse/Unendorse a mod
   * @param modId {number} (nexus) id of the mod to endorse
   * @param modVersion {string} version of the mod the user has installed (has to correspond to a version that actually exists)
   * @param endorseStatus {'endorse' | 'abstain'} the new endorsement state
   * @param gameId {string} (nexus) id of the game to endorse
   */
  public async endorseMod(modId: number, modVersion: string,
                          endorseStatus: 'endorse' | 'abstain', gameId?: string): Promise<any> {
    if (['endorse', 'abstain'].indexOf(endorseStatus) === -1) {
      return Promise.reject('invalid endorse status, should be "endorse" or "abstain"');
    }
    await this.mQuota.wait();
    return this.request(this.mBaseURL + '/games/{gameId}/mods/{modId}/{endorseStatus}', this.args({
      path: this.filter({ gameId, modId, endorseStatus }),
      data: this.filter({ Version: modVersion }),
    }));
  }

  /**
   * retrieve a list of all games currently supported by Nexus Mods
   * @returns list of games
   */
  public async getGames(): Promise<types.IGameListEntry[]> {
    await this.mQuota.wait();
    return this.request(this.mBaseURL + '/games', this.args({}));
  }

  /**
   * retrieve details about a specific game
   * @param gameId {string} (nexus) game id to request
   */
  public async getGameInfo(gameId?: string): Promise<types.IGameInfo> {
    await this.mQuota.wait();
    return this.request(this.mBaseURL + '/games/{gameId}', this.args({
      path: this.filter({ gameId }),
    }));
  }

  /**
   * retrieve details about a mod
   * @param modId {number} (nexus) id of the mod
   * @param gameId {string} (nexus) game id
   */
  public async getModInfo(modId: number, gameId?: string): Promise<types.IModInfo> {
    await this.mQuota.wait();
    return this.request(this.mBaseURL + '/games/{gameId}/mods/{modId}', this.args({
      path: this.filter({ modId, gameId }),
    }));
  }

  /**
   * get list of all files uploaded for a mod
   * @param modId {number} (nexus) id of the mod
   * @param gameId {string} (nexus) game id
   */
  public async getModFiles(modId: number, gameId?: string): Promise<types.IModFiles> {
    await this.mQuota.wait();
    return this.request(this.mBaseURL + '/games/{gameId}/mods/{modId}/files', this.args({
      path: this.filter({ modId, gameId }),
    }));
  }

  /**
   * get details about a file
   * @param modId (nexus) id of the mod
   * @param fileId (nexus) id of the file
   * @param gameId (nexus) id of the game
   */
  public async getFileInfo(modId: number,
                           fileId: number,
                           gameId?: string): Promise<types.IFileInfo> {
    await this.mQuota.wait();
    return this.request(this.mBaseURL + '/games/{gameId}/mods/{modId}/files/{fileId}', this.args({
      path: this.filter({ modId, fileId, gameId }),
    }));
  }

  /**
   * generate download links for a file
   * If the user isn't premium on Nexus Mods, this requires a key that can only
   * be generated on the website. The key is part of the nxm links that are generated by the "Download with Manager" buttons.
   * @param modId id of the mod
   * @param fileId id of the file
   * @param key a download key
   * @param expires expiry time of the key
   * @param gameId id of the game
   */
  public async getDownloadURLs(modId: number,
                               fileId: number,
                               key?: string,
                               expires?: number,
                               gameId?: string): Promise<types.IDownloadURL[]> {
    await this.mQuota.wait();
    let urlPath = '/games/{gameId}/mods/{modId}/files/{fileId}/download_link';
    if ((key !== undefined) && (expires !== undefined)) {
      urlPath += '?key={key}&expires={expires}';
    }
    return this.request(this.mBaseURL + urlPath,
                this.args({ path: this.filter({ modId, fileId, gameId, key, expires }) }));
  }

  /**
   * find information about a file based on its md5 hash
   * This can be used to find info about a file when you don't have its modid and fileid
   * Note that technically there may be multiple results for the same md5 hash, either the same
   * file uploaded in different places or (less likely) different files that just happen to have
   * the same hash.
   * This function will return all of them, you will have to sort out from the result which file
   * you were actually looking for (e.g. by comparing size)
   * @param hash the md5 hash of the file
   * @param gameId the game to search in
   */
  public async getFileByMD5(hash: string, gameId?: string): Promise<types.IMD5Result[]> {
    await this.mQuota.wait();
    const urlPath = '/games/{gameId}/mods/md5_search/{hash}';
    try {
    return this.request(this.mBaseURL + urlPath,
                this.args({path: this.filter({ gameId, hash })}));
    } catch (err) {
      if (err.code === '422') {
        throw new ParameterInvalid(err.message);
      } else {
        throw err;
      }
    }
  }

  /**
   * get list of issues reported by this user
   * FOR INTERNAL USE ONLY
   */
  public async getOwnIssues(): Promise<types.IIssue[]> {
    await this.mQuota.wait();
    return this.request(this.mBaseURL + '/feedbacks/list_user_issues/', this.args({}))
      .then(obj => obj.issues);
  }

  /**
   * send a feedback message
   * FOR INTERNAL USE ONLY
   *
   * @param title title of the message
   * @param message content
   * @param fileBundle path to an archive that is sent along
   * @param anonymous whether the report should be made anonymously
   * @param groupingKey a key that is used to group identical reports
   * @param id reference id
   */
  public async sendFeedback(title: string,
                            message: string,
                            fileBundle: string,
                            anonymous: boolean,
                            groupingKey?: string,
                            id?: string): Promise<types.IFeedbackResponse> {
    await this.mQuota.wait();
    if (message.length === 0) {
      return Promise.reject(new Error('Feedback message can\'t be empty'));
    }
    return this.checkFileSize(fileBundle)
      .then(() => new Promise<types.IFeedbackResponse>((resolve, reject) => {
        const formData = {
          feedback_text: message,
          feedback_title: title.substr(0, 255),
        };
        if (fileBundle !== undefined) {
          formData['feedback_file'] = fs.createReadStream(fileBundle);
        }
        if (groupingKey !== undefined) {
          formData['grouping_key'] = groupingKey;
        }
        if (id !== undefined) {
          formData['reference'] = id;
        }
        const headers = { ...this.mBaseData.headers };

        if (anonymous) {
          delete headers['APIKEY'];
          console.log('anon headers', headers);
        }

        const url = anonymous
          ? `${param.API_URL}/feedbacks/anonymous`
          : `${param.API_URL}/feedbacks`;

        request.post({
          headers,
          url,
          formData,
          timeout: 30000,
        }, (error, response, body) => {
          if (error !== null) {
            return reject(error);
          } else if (response.statusCode >= 400) {
            return reject(new HTTPError(response.statusCode, response.statusMessage, body));
          } else {
            return resolve(JSON.parse(body));
          }
        });
      }));
  }

  private checkFileSize(filePath: string): Promise<void> {
    if (filePath === undefined) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      fs.stat(filePath, (err: Error, stats: fs.Stats) => {
        if (err !== null) {
          return reject(err);
        }

        if (stats.size > param.MAX_FILE_SIZE) {
          return reject(new ParameterInvalid('The attachment is too large'));
        }

        resolve();
      });
    });
  }

  private async request(url: string, args: IRequestArgs): Promise<any> {
    try {
      return await rest(url, args);
    } catch (err) {
      if (err instanceof RateLimitError) {
        this.mQuota.reset();
        await new Promise((resolve) => {
          setTimeout(resolve, param.DELAY_AFTER_429_MS);
        });
        await this.mQuota.wait();
        return await this.request(url, args);
      } else {
        throw err;
      }
    }
  }

  private filter(obj: any): any {
    const result = {};
    Object.keys(obj).forEach((key) => {
      if (obj[key] !== undefined) {
        result[key] = obj[key];
      }
    });
    return result;
  }

  private args(customArgs: IRequestArgs) {
    const result: IRequestArgs = { ...this.mBaseData };
    for (const key of Object.keys(customArgs)) {
      result[key] = {
        ...result[key],
        ...customArgs[key],
      };
    }
    return result;
  }
}

export default Nexus;
