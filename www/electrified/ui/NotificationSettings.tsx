import React, {CSSProperties, FunctionComponent, ReactNode} from "react";
import {
    watchedComponent,
    useWatchedState,
    bind,
    load,
    isLoading,
    READS_INSIDE_LOADER_FN,
    watched
} from "react-deepwatch";
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
import {NotificationFilter} from "../Notification";
import type {Application} from "../Application";
import {instanceOf} from "prop-types";

export async function showNotificationSettings() {
    const app = getElectrifiedApp();

    const result = await showBlueprintDialog({title: t`Notification settings`, style: {width: "1250px"}},(props) => {
        const state = useWatchedState(new class {
            filterByType: "all" | "datacenter" | "user"  = "all";
            filterText= ""; // Searchfilter
        })


        // Determine items:
        let items: Application["userConfig"]["notificationSettings"];
        const datacenterSettings = watched(getElectrifiedApp().datacenterConfig).notificationSettings.map(s => {return {...s, type: "datacenter"}});
        const userSettings = watched(getElectrifiedApp().userConfig).notificationSettings.map(s => {return {...s, type: "user"}});
        if(state.filterByType === "all") {
            items = [...datacenterSettings, ...userSettings]
        }
        else if(state.filterByType === "datacenter") {
            items = datacenterSettings
        }
        else if(state.filterByType === "user") {
            items = userSettings;
        }
        else {
            throw new Error("Unhandled");
        }
        // Filter items:
        items = items.filter(item => item.settings.muted); // Only muted
        if(state.filterText) {
            // Search in all strings under item.filter:
            items = items.filter(item => {
                const f = item.filter as any;
                return Object.keys(f).some(k => f[k] !== null && typeof f[k] === "string" && f[k].toLowerCase().indexOf(state.filterText.toLowerCase()) >= 0)
            })
        }

        return <div >
            <div className={Classes.DIALOG_BODY}>
                <h2>{t`Muted notifications`}</h2>
                {/* Filter row*/}
                <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "8px" }}>
                    <Icon icon={"filter"}/>
                    <HTMLSelect title={gettext("Type")} {...bind(state.filterByType)}>
                        <option value={"all"}>{gettext("All")}</option>
                        <option value={"datacenter"}>{t`Muted for all users in datacenter`}</option>
                        <option value={"user"}>{t`Muted for current user`}</option>
                    </HTMLSelect>

                    <InputGroup type="search" leftIcon={"search"} placeholder={gettext("Search")} {...bind(state.filterText)} />
                </div>

                <TableContainer style={{ height: 600 }} >
                    <Table sx={{ minWidth: 650}} aria-label="Plugin table" size={"small"} stickyHeader>
                        <TableHead>
                            <TableRow>
                                <TableCell></TableCell>
                                <TableCell>{t`Class name`}</TableCell>
                                <TableCell>{t`Scope`}</TableCell>
                                <TableCell>{t`Action`}</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {items.map(item => {
                                const cellStyle: CSSProperties = {verticalAlign: "top"}
                                const type: "datacenter" | "user" = (item as any).type;
                                return <TableRow key={`${type}_${item.filter.classId}_${item.filter.forType}_${item.filter.forId}`}>
                                    {/* Type */}
                                    <TableCell style={cellStyle}>
                                        {type === "datacenter"?<span className={"fa fa-server"}/>:<span className={"fa fa-user"}/>}
                                    </TableCell>
                                    {/* Class name */}
                                    <TableCell style={cellStyle}>
                                        {item.filter.cache_ui_className || item.filter.classId}
                                    </TableCell>
                                    {/* Scope */}
                                    <TableCell style={cellStyle}>
                                        {item.filter.forType === item.filter.cache_aboutType?
                                            <strong>{t`For ${item.filter.cache_for_ui_string || item.filter.forType}`}</strong> :
                                            <span>{t`For all ${item.filter.cache_about_ui_pluralType || "..."}`} <strong>{t`under ${item.filter.cache_for_ui_string || item.filter.forType}`}</strong></span>}
                                    </TableCell>
                                    {/* Action */}
                                    <TableCell style={cellStyle}>
                                        <Button icon={<span className={"fa fa-bell"}/>} onClick={() => item.settings.muted = false}>Un-mute</Button>
                                    </TableCell>
                                </TableRow>
                            })}
                        </TableBody>
                    </Table>
                </TableContainer>
            </div>
            <div className={Classes.DIALOG_FOOTER}>
                <div className={Classes.DIALOG_FOOTER_ACTIONS}>
                    <ButtonGroup>
                        <Button onClick={() => items.forEach(i => i.settings.muted = false)} intent={Intent.PRIMARY} disabled={items.length === 0} icon={<span className={"fa fa-bell"}/>}>{t`Unmute all`}</Button>
                        <Button onClick={() => props.resolve(undefined)}>{t`Close`}</Button>
                    </ButtonGroup>
                </div>
            </div>
        </div>
    });
}