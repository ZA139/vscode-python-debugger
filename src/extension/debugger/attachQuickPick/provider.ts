// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { l10n } from 'vscode';
import { getOSType, OSType } from '../../common/platform';
import { PsProcessParser } from './psProcessParser';
import { IAttachItem, IAttachProcessProvider, ProcessListCommand } from './types';
import { PowerShellProcessParser } from './powerShellProcessParser';
import { getEnvironmentVariables } from '../../common/python';
import { plainExec } from '../../common/process/rawProcessApis';
import { logProcess } from '../../common/process/logger';
import { WmicProcessParser } from './wmicProcessParser';

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

    public async _getInternalProcessEntries(): Promise<IAttachItem[]> {
        let processCmd: ProcessListCommand;
        const osType = getOSType();
        if (osType === OSType.OSX) {
            processCmd = PsProcessParser.psDarwinCommand;
        } else if (osType === OSType.Linux) {
            processCmd = PsProcessParser.psLinuxCommand;
        } else if (osType === OSType.Windows) {
            processCmd = PowerShellProcessParser.powerShellCommand;
        } else {
            throw new Error(l10n.t("Operating system '{0}' not supported.", osType));
        }

        const customEnvVars = await getEnvironmentVariables();
        if (processCmd === PowerShellProcessParser.powerShellCommand) {
            try {
                const checkPowerShell = await plainExec(
                    'where',
                    ['powershell'],
                    { throwOnStdErr: false },
                    customEnvVars,
                );
                if (checkPowerShell.stdout.length === 0) {
                    processCmd = WmicProcessParser.wmicCommand;
                }
            } catch {
                // If 'where' fails, fall back to wmic (most likely powershell is not available).(Windows Xp or below？
                console.log('PowerShell check failed, using WMIC fallback');
                processCmd = WmicProcessParser.wmicCommand;
            }
        }
        const output = await plainExec(processCmd.command, processCmd.args, { throwOnStdErr: true }, customEnvVars);
        logProcess(processCmd.command, processCmd.args, { throwOnStdErr: true });

        if (osType === OSType.Windows) {
            if (processCmd === WmicProcessParser.wmicCommand) {
                return WmicProcessParser.parseProcesses(output.stdout);
            } else if (processCmd === PowerShellProcessParser.powerShellCommand) {
                return PowerShellProcessParser.parseProcesses(output.stdout);
            }
        }
        return PsProcessParser.parseProcesses(output.stdout);
    }
}
