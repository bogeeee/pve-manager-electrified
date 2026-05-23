import React, {CSSProperties, FunctionComponent, ReactNode, useEffect, useRef} from "react";
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
import {
    confirm,
    formatDate,
    showBlueprintDialog,
    spawnAsync,
    throwError,
    spawnWithErrorHandling,
    capitalize
} from "../util/util";
import {getElectrifiedApp, gettext, t} from "../globals";
import _ from "underscore";
import {Table, TableBody, TableCell, TableContainer, TableHead, TableRow} from "@mui/material";
import clone from "clone";
import type {Application} from "../Application";
import {instanceOf} from "prop-types";

export async function showGeneralSettings(scrollToSectionName?:string) {
    const app = getElectrifiedApp();

    const result = await showBlueprintDialog({title: t`Settings`, style: {width: "1250px", height: "800px"}},(props) => {
        const app = getElectrifiedApp();
        const datacenterConfig = watched(app.datacenterConfig);
        const useConfig = watched(app.userConfig);
        const state = useWatchedState(new class {

        })
        const targetedSectionRef = useRef<HTMLElement>();

        // Scroll to scrollToSectionName:
        useEffect(() => {
            if(scrollToSectionName) {
                (targetedSectionRef.current || throwError("section not available")).scrollIntoView({behavior: "smooth", block: "start"})
            }
        },[])

        return <div>
            <div className={Classes.DIALOG_BODY} style={{height: "700px", width:"100%", overflowY: "auto", marginLeft: 0, marginRight: 0, paddingLeft: "16px", paddingRight: "16px"}}>
                <h2 ref={scrollToSectionName === "start-stop"?(targetedSectionRef as any):undefined}>{t`Start / stop`}</h2>
                <div><input type="checkbox" {...bind(useConfig.shutdownGuestWithoutConfirm)} />&#160;{t`Shutdown / stop / reboot / reset guests without confirm`}</div>
            </div>

            <div className={Classes.DIALOG_FOOTER}>
                <div className={Classes.DIALOG_FOOTER_ACTIONS}>
                    <ButtonGroup>
                        <Button onClick={() => props.resolve(true)} intent={Intent.PRIMARY}>{t`Close`}</Button>
                    </ButtonGroup>
                </div>
            </div>
        </div>;

        });
}