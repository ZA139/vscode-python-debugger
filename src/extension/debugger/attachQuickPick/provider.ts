// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { l10n } from 'vscode';
import { getOSType, OSType } from '../../common/platform';
import { PsProcessParser } from './psProcessParser';
import { IAttachItem, IAttachProcessProvider, ProcessListCommand } from './types';
import { WmicProcessParser } from './wmicProcessParser';
import { getEnvironmentVariables } from '../../common/python';
import { plainExec } from '../../common/process/rawProcessApis';
import { logProcess } from '../../common/process/logger';
import { getAllProcesses, ProcessDataFlag } from '@vscode/windows-process-tree';

export class AttachProcessProvider implements IAttachProcessProvider {
    constructor() {}

    public getAttachItems(): Promise<IAttachItem[]> {
        return this._getInternalProcessEntries().then((processEntries) => {
            processEntries.sort(
                (
                    { processName: aprocessName, commandLine: aCommandLine },
                    { processName: bProcessName, commandLine: bCommandLine },
                ) => {
                    const compare = (aString: string, bString: string): number => {
                        // localeCompare is significantly slower than < and > (2000 ms vs 80 ms for 10,000 elements)
                        // We can change to localeCompare if this becomes an issue
                        const aLower = aString.toLowerCase();
                        const bLower = bString.toLowerCase();

                        if (aLower === bLower) {
                            return 0;
                        }

                        return aLower < bLower ? -1 : 1;
                    };

                    const aPython = aprocessName.startsWith('python');
                    const bPython = bProcessName.startsWith('python');

                    if (aPython || bPython) {
                        if (aPython && !bPython) {
                            return -1;
                        }
                        if (bPython && !aPython) {
                            return 1;
                        }

                        return aPython ? compare(aCommandLine!, bCommandLine!) : compare(bCommandLine!, aCommandLine!);
                    }

                    return compare(aprocessName, bProcessName);
                },
            );

            return processEntries;
        });
    }

    /**
     * Get processes using windows-process-tree getAllProcesses API
     */
    private async _getProcessesViaWindowsProcessTree(): Promise<IAttachItem[]> {
        return new Promise((resolve, reject) => {
            getAllProcesses((processList) => {
                if (!processList) {
                    reject(new Error('Failed to get process list'));
                    return;
                }
                const items = processList.map((p) => ({
                    label: p.name,
                    description: String(p.pid),
                    detail: p.commandLine || '',
                    id: String(p.pid),
                    processName: p.name,
                    commandLine: p.commandLine || '',
                }));
                resolve(items);
            }, ProcessDataFlag.CommandLine);
        });
    }

    /**
     * Get processes via wmic (fallback for Windows)
     */
    private async _getProcessesViaWmic(): Promise<IAttachItem[]> {
        const customEnvVars = await getEnvironmentVariables();
        const output = await plainExec(
            WmicProcessParser.wmicCommand.command,
            WmicProcessParser.wmicCommand.args,
            { throwOnStdErr: true },
            customEnvVars,
        );
        logProcess(WmicProcessParser.wmicCommand.command, WmicProcessParser.wmicCommand.args, { throwOnStdErr: true });
        return WmicProcessParser.parseProcesses(output.stdout);
    }

    /**
     * Get processes via Ps parser (Linux/macOS)
     */
    private async _getProcessesViaPsParser(cmd: ProcessListCommand): Promise<IAttachItem[]> {
        const customEnvVars = await getEnvironmentVariables();
        const output = await plainExec(cmd.command, cmd.args, { throwOnStdErr: true }, customEnvVars);
        logProcess(cmd.command, cmd.args, { throwOnStdErr: true });
        return PsProcessParser.parseProcesses(output.stdout);
    }

    public async _getInternalProcessEntries(): Promise<IAttachItem[]> {
        const osType = getOSType();

        if (osType === OSType.Windows) {
            try {
                // Try windows-process-tree first
                return await this._getProcessesViaWindowsProcessTree();
            } catch (error) {
                console.error('Failed to get processes via windows-process-tree:', error);
                // Fallback to wmic
                return this._getProcessesViaWmic();
            }
        } else if (osType === OSType.OSX) {
            return this._getProcessesViaPsParser(PsProcessParser.psDarwinCommand);
        } else if (osType === OSType.Linux) {
            return this._getProcessesViaPsParser(PsProcessParser.psLinuxCommand);
        } else {
            throw new Error(l10n.t("Operating system '{0}' not supported.", osType));
        }
    }
}
