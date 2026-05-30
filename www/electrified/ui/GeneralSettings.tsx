import React, {CSSProperties, FunctionComponent, ReactNode, useEffect, useRef} from "react";
import {
    watchedComponent,
    useWatchedState,
    bind,
    load,
    isLoading,
    READS_INSIDE_LOADER_FN,
    watched, binding
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
    MenuItem, NumericInput,
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
    capitalize, InfoTooltip, WriteBufferedValueOnObject, SmallErrorBoundary
} from "../util/util";
import {getElectrifiedApp, gettext, t} from "../globals";
import _ from "underscore";
import {Table, TableBody, TableCell, TableContainer, TableHead, TableRow} from "@mui/material";
import clone from "clone";
import type {Application} from "../Application";
import {instanceOf} from "prop-types";
import {Node} from "../model/Node"

const RamHeadroomInput = watchedComponent((props: {node: Node}) => {
    const {node} = props;
    const nodeCfg = watched(node.config);

    const state = useWatchedState(new class {
        bufferedValue = new WriteBufferedValueOnObject(binding(nodeCfg.ramHeadroomWhenStartingGuestsInMib),1000);
    })

    return <NumericInput value={state.bufferedValue.value} onValueChange={(val) => state.bufferedValue.value = val} min={0} max={999999999} style={{width: "80px"}}/>
})

export async function showGeneralSettings(scrollToSectionName?:string) {
    const app = getElectrifiedApp();

    const result = await showBlueprintDialog({title: t`Settings`, style: {width: "1250px", height: "800px"}},(props) => {
        const app = getElectrifiedApp();
        const datacenter = watched(app.datacenter);
        const datacenterConfig = watched(app.datacenterConfig);
        const userConfig = watched(app.userConfig);
        const state = useWatchedState(new class {
            offerRawFieldTreeColumns_changed = 0;
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
                {/* Start / stop*/}
                <h2 ref={scrollToSectionName === "start-stop"?(targetedSectionRef as any):undefined}>{t`Start / stop`}</h2>
                <div><input type="checkbox" {...bind(userConfig.shutdownGuestWithoutConfirm)} />&#160;{t`Shutdown / stop / reboot / reset guests without confirm`}</div>
                {/* Ram conflict dialog: */}
                <h3 ref={scrollToSectionName === "ram-conflict-dialog"?(targetedSectionRef as any):undefined}>{t`Ram conflict dialog`}</h3>
                <i>{t`Will pop up a warning dialog when starting guests and these criteria are not met:`}</i><br/>
                {datacenter.nodes.map(node => {
                    const textHeadroom = t`Ensure XXX MiB free headroom when starting guests`;
                    return <div style={{display: "flex", gap: "3px", alignItems: "center", paddingLeft: "4px"}}><span className={`fa fa-fw fa-${node.faIcon}`}/> <strong>{node.name}:</strong> {textHeadroom.substring(0, textHeadroom.indexOf("XXX"))}<SmallErrorBoundary><RamHeadroomInput node={node}/></SmallErrorBoundary>{textHeadroom.substring(textHeadroom.indexOf("XXX")+3)}
                </div>})}


                {/* Offer resource-tree columns for raw fields
                The value can't be stored in the userConfig because it is needed before the userConfig is initialized.
                */}
                <h2 ref={scrollToSectionName === "gerneral_ui"?(targetedSectionRef as any):undefined}>{t`UI (misc)`}</h2>
                <div><input type="checkbox" checked={window.localStorage.getItem("electrified_offerRawFieldTreeColumns") === "true"} onChange={(event) => {window.localStorage.setItem("electrified_offerRawFieldTreeColumns", String(event.currentTarget.checked)); state.offerRawFieldTreeColumns_changed++}} />&#160;<i>{t`Offer resource-tree columns for raw fields.`}</i><InfoTooltip><div>{t`They can be activated here:`}<br/><br/><img src="/images/screenshot_resourceTree_raw_fields.png"/></div></InfoTooltip></div>
                {state.offerRawFieldTreeColumns_changed?<div style={{paddingLeft: "20px"}}><Icon icon={"warning-sign"}/>{t`You need to reload the page to see the changes`}</div>:undefined}
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