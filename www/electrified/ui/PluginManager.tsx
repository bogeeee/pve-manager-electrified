import React, {CSSProperties, FunctionComponent, ReactNode} from "react";
import {watchedComponent, useWatchedState, bind, load, isLoading, READS_INSIDE_LOADER_FN} from "react-deepwatch";
import {
    Button,
    ButtonGroup, Checkbox,
    Classes,
    HTMLSelect,
    Icon,
    InputGroup,
    Intent,
    Label,
    Menu,
    MenuItem,
    Popover, Tooltip,
} from "@blueprintjs/core";
import "@blueprintjs/core/lib/css/blueprint.css";
import "@blueprintjs/icons/lib/css/blueprint-icons.css";
import {confirm, formatDate, showBlueprintDialog, spawnAsync, throwError, spawnWithErrorHandling} from "../util/util";
import {getElectrifiedApp, gettext, t} from "../globals";
import _ from "underscore";
import {Table, TableBody, TableCell, TableContainer, TableHead, TableRow} from "@mui/material";
import clone from "clone";

export async function showPluginManager() {
    const app = getElectrifiedApp();

    const result = await showBlueprintDialog({title: gettext("Electrified plugins"), style: {width: "1250px"}},(props) => {
        const state = useWatchedState(new class {
            filterByType: "all" | "installed" = "installed";
            filterText= ""; // Searchfilter
            stagingPluginConfig = clone(app.nodeConfig.plugins); // Staging until apply is clicked
        })

        let plugins = load(() => app.currentNode.electrifiedApi.getPlugins(state.filterByType), {preserve: false, fallback: [], name: "plugins"});
        if(state.filterText) {
            // Filter plugin by the search input:
            const matches = (value?:string) => value && value.toLowerCase().indexOf(state.filterText.toLowerCase()) >=0;
            plugins = plugins.filter(p => matches(p.name) || matches(p.description));
        }

        const pluginsDisabledInCurrentBuild = app.webBuildState.builtWeb.buildOptions.enablePlugins === false;
        const stagingPluginConfigHasChanged = !_.isEqual(app.nodeConfig.plugins, state.stagingPluginConfig);

        function applyChanges() {
            spawnAsync(async () => {
                if(state.stagingPluginConfig.some(plugin => plugin.codeLocation === "npm" && !app.nodeConfig.plugins.some(s => s.codeLocation === plugin.codeLocation && s.name === plugin.name))) { // A new npm plugin was added?
                    if(!await confirm(gettext("Security: Confirm trusting the author"), gettext("You are adding plugin(s) from a public repository. Be aware that these plugins can be authored by **anyone from the internet**! Make sure, you trust the author(s). Also check the exact spelling of the plugin name(s)"))) {
                        return;
                    }
                }

                app.nodeConfig.plugins = state.stagingPluginConfig; // Apply changes and automatically rebuilds and reloads
                // For, when only re-enabling enablePlugins:
                await app.currentNode.electrifiedApi.rebuildWebAsync({...app.webBuildState.builtWeb.buildOptions, enablePlugins: true});

                props.resolve("ok"); // Closes dialog
            })
        }

        async function updateAllNpmPluginsToLatestVersion(dry = false) {
            let updated = 0;
            for(const plugin of state.stagingPluginConfig.filter(p => p.codeLocation === "npm")) {
                const allVersions = await app.currentNode.electrifiedApi.getNpmPackageVersions(plugin.name);
                if(allVersions.length > 0 && allVersions[0].version !== plugin.version) {
                    if(!dry) {
                        plugin.version = allVersions[0].version;
                    }
                    updated++;
                }
            }

            return updated;
        }
        const numberOfUpgradableNpmPackages = load( () => updateAllNpmPluginsToLatestVersion(true), {fallback: 0});


        return <div >
            <div className={Classes.DIALOG_BODY}>
                {/* Filter row*/}
                <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "8px" }}>
                    <Icon icon={"filter"}/>
                    <HTMLSelect title={gettext("Type")} {...bind(state.filterByType)}>
                        <option value={"installed"}>{gettext("Installed")}</option>
                        <option value={"all"}>{gettext("All")}</option>
                    </HTMLSelect>

                    <InputGroup type="search" leftIcon={"search"} placeholder={gettext("Search")} {...bind(state.filterText)} />
                </div>

                <TableContainer style={{ height: 600 }} >
                    <Table sx={{ minWidth: 650}} aria-label="Plugin table" size={"small"} stickyHeader>
                        <TableHead>
                            <TableRow>
                                <TableCell>{gettext("Installed")}</TableCell>
                                <TableCell>{gettext("Type")}</TableCell>
                                <TableCell>{gettext("Name")}</TableCell>
                                <TableCell style={{whiteSpace: "nowrap"}}>{gettext("Version")}/<br/>{gettext("Last updated")}</TableCell>
                                <TableCell style={{width: "100%"}}>{gettext("Description")}</TableCell>
                                <TableCell align="right">{gettext("Actions")}</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {plugins.map((plugin) => {
                                const shortName = plugin.name.replace(/^pveme-ui-plugin-/,"");

                                const stagingPluginEntry = state.stagingPluginConfig.find(s => s.codeLocation === plugin.codeLocation && s.name === plugin.name);

                                // Retrieve isOverridden and isInstalled:
                                let isOverridden = false;
                                let diagnosis_overriddenCause = "";
                                let isInstalled = true;
                                if(plugin.codeLocation === "datacenter") {
                                    isOverridden = plugins.some(p => p.name === plugin.name && p.codeLocation === "local"); // A local plugin with this name exists ?
                                    if(isOverridden) {
                                        diagnosis_overriddenCause = gettext("This plugin is not active on **this node** because a local-/source plugin with the same name exists and has precedence.")
                                    }
                                }
                                else if(plugin.codeLocation === "npm") {
                                    isOverridden = plugins.some(p => p.name === plugin.name && p.codeLocation !== plugin.codeLocation); // Another non-npm plugin with this name exists ?
                                    if(isOverridden) {
                                        diagnosis_overriddenCause = gettext("This plugin is not active because a local-/source plugin or a datacenter-wide plugin with the same name exists and has precedence.")
                                    }

                                    isInstalled = stagingPluginEntry !== undefined// is listed in staging plugin config
                                }

                                const setInstalled = (value: boolean) => {
                                    plugin.codeLocation === "npm" || throwError("Illegal argument");
                                    if(value) {
                                        state.stagingPluginConfig.push({name: plugin.name, version: plugin.version, codeLocation: plugin.codeLocation as any})
                                    }
                                    else {
                                        state.stagingPluginConfig = state.stagingPluginConfig.filter(s => !(s.codeLocation === plugin.codeLocation && s.name === plugin.name)); // Remove from stagingPluginConfig
                                    }
                                }

                                const pluginInstance = !isOverridden?app.getPluginByName(plugin.name):undefined;

                                // Retrieve icon / info:
                                let icon: ReactNode;
                                let infoForType: string = "";
                                if(plugin.codeLocation === "local") {
                                    icon = <Icon icon="code" /> ;
                                    infoForType = gettext("Source project from") + " /root/pveme-plugin-source-projects/" + plugin.name;
                                }
                                else if(plugin.codeLocation === "datacenter") {
                                    icon = <div className="fa fa-server" />
                                    infoForType = gettext("Datacenter-wide plugin from") + " /etc/pve/manager/plugin-packages/" + plugin.name;
                                }
                                else if(plugin.codeLocation === "npm") {
                                    icon = <Icon icon="globe-network" />;
                                    infoForType = gettext("NPM package (public repository / anyone can offer plugins here)")
                                }

                                let homepage = plugin.homepage || (plugin.codeLocation === "npm"?`https://www.npmjs.com/package/${plugin.name}`:undefined)

                                const cellStyle: CSSProperties = {verticalAlign: "top", textDecoration: isOverridden?"line-through":undefined}

                                return <TableRow key={plugin.name + "_" + plugin.codeLocation} sx={{ '&:last-child td, &:last-child th': { border: 0 } }}>
                                    {/* Installed */}
                                    <TableCell style={cellStyle}>
                                        <Checkbox checked={isInstalled} disabled={isOverridden || plugin.codeLocation !== "npm"} onChange={(e) => setInstalled(e.target.checked)}/>
                                    </TableCell>

                                    {/* Type */}
                                    <TableCell style={cellStyle}>
                                        <Tooltip interactionKind={"hover"} content={<div>{infoForType}</div>}>
                                            {icon}
                                        </Tooltip>
                                    </TableCell>

                                    {/* Name */}
                                    <TableCell style={{...cellStyle, whiteSpace: "nowrap"}}>
                                        <strong>{shortName}</strong>
                                    </TableCell>

                                    {/* Version */}
                                    <TableCell style={{...cellStyle, whiteSpace: "nowrap"}}>
                                        {
                                            stagingPluginEntry && plugin.codeLocation === "npm"?
                                                <HTMLSelect {...bind(stagingPluginEntry.version)}>
                                                    {
                                                        load(async () => await app.currentNode.electrifiedApi.getNpmPackageVersions(plugin.name),  {preserve: false, fallback: [{version: "loading"}], deps: [READS_INSIDE_LOADER_FN]})
                                                            .map(entry => <option key={entry.version} value={entry.version}>{entry.version}</option>)
                                                    }
                                                </HTMLSelect>
                                                :
                                                <strong>{plugin.version}</strong>
                                        }
                                        <br/>
                                        <span>{plugin.updated?formatDate(new Date(plugin.updated)):undefined}</span>
                                    </TableCell>

                                    {/* Description */}
                                    <TableCell style={cellStyle}>
                                        {plugin.description}
                                    </TableCell>

                                    {/* Actions */}
                                    <TableCell style={cellStyle}>
                                        <ButtonGroup>
                                            {/* Homepage button: */}
                                            <a href={homepage} target="pluginHomepage">
                                                <Button icon="home" title={homepage?gettext("Visit homepage") + " " + homepage:undefined} disabled={!homepage}/>
                                            </a>
                                            {/* Info button: */}
                                            <Popover content={
                                                <div style={{padding: "16px"}}>
                                                    {gettext("Full name")}: <strong>{plugin.name}</strong><br/>
                                                    {gettext("Type")}: {infoForType}<br/>
                                                    {diagnosis_overriddenCause}
                                                </div>}>
                                                <Button icon="info-sign" title={gettext("Info")}/>
                                            </Popover>
                                            {/* Configure button:*/}
                                            <Button icon={"cog"} title={gettext("Configure")} disabled={!(pluginInstance && Object.hasOwn(Object.getPrototypeOf(pluginInstance), "showConfigurationDialog"))} onClick={() => spawnAsync(async () => await app.getPluginByName(plugin.name)?.showConfigurationDialog())}/>
                                            {/* Action buttons: */}
                                            <Popover content={
                                                <Menu>
                                                    {
                                                        // Publish to all nodes in the datacenter:
                                                        plugin.codeLocation === "local" ?
                                                            <MenuItem text={t`Publish to all nodes in the datacenter`}
                                                                      onClick={() => spawnWithErrorHandling(async () => {
                                                                          await app.datacenter.queryHasQuorum() || throwError("No quorum");
                                                                          await app.currentNode.execCommand`mkdir -p /etc/pve/manager/plugin-packages`
                                                                          await app.currentNode.execCommand`rsync -r --exclude='node_modules' /root/pveme-plugin-source-projects/${shortName}/ /etc/pve/manager/plugin-packages/${shortName}`
                                                                      })}/> : undefined
                                                    }
                                                    {
                                                        // delete package
                                                        plugin.codeLocation === "datacenter" ?
                                                            <MenuItem text={t`Delete`}
                                                                      onClick={() => spawnWithErrorHandling(async () => {
                                                                          if (!await confirm(t`Delete plugin ${shortName}`, t`The plugin files will be deleted on all nodes in the datacenter.`)) {
                                                                              return
                                                                          }
                                                                          await app.datacenter.queryHasQuorum() || throwError("No quorum");
                                                                          await app.currentNode.execCommand`rm -r /etc/pve/manager/plugin-packages/${shortName}`
                                                                      })}/> : undefined
                                                    }

                                                </Menu>} placement="bottom">
                                                <Button title={gettext("Actions")} alignText="start" icon="menu" endIcon="caret-down" disabled={!isInstalled} />
                                            </Popover>
                                        </ButtonGroup>
                                    </TableCell>
                                </TableRow>
                            })}
                            {
                                /* "Loading..." */
                                isLoading("plugins")?<TableRow><TableCell colSpan={99} style={{textAlign: "center"}}>Loading...</TableCell></TableRow>:undefined
                            }
                            {
                                /* "Show all available plugins" button: */
                                state.filterByType === "installed"?<TableRow><TableCell colSpan={99} style={{textAlign: "center"}}><i><Icon icon="hand-right"/> <a onClick={() => state.filterByType = "all"}>{gettext("Browse all available plugins")}</a></i></TableCell></TableRow>:undefined
                            }
                        </TableBody>
                    </Table>
                </TableContainer>

                {/* JSON.stringify(state) */}

                {/* Plugins disabled warning: */}
                {pluginsDisabledInCurrentBuild?
                    <div style={{textAlign: "center", fontSize: "17px"}}><Icon icon={"warning-sign"} size={25}/> {gettext("All plugins are currently disabled")}</div>
                    :undefined}

                {/* Update plugins hint + button: */}
                <div style={{textAlign: "right"}}>{numberOfUpgradableNpmPackages > 0?<span>{t`${numberOfUpgradableNpmPackages} plugin(s) can be updated.`} <a onClick={() => spawnAsync( async () => {await updateAllNpmPluginsToLatestVersion()})}>update</a></span>:undefined}&#160;</div>
            </div>

            <div className={Classes.DIALOG_FOOTER}>
                <div className={Classes.DIALOG_FOOTER_ACTIONS}>
                    <ButtonGroup>
                        <Button onClick={applyChanges} intent={Intent.PRIMARY} disabled={!stagingPluginConfigHasChanged && !pluginsDisabledInCurrentBuild}>{pluginsDisabledInCurrentBuild?(stagingPluginConfigHasChanged?gettext("Re-enable plugins and apply changes"):gettext("Re-enable plugins")):gettext("Apply changes")}</Button>
                        <Button onClick={() => props.resolve(undefined)}>Cancel</Button>
                    </ButtonGroup>
                </div>
            </div>
        </div>;
    });
}