import type {Plugin} from "./Plugin"
import {extend_quick, HoverTooltip, InfoTooltip, spawnAsync, spawnWithErrorHandling, throwError} from "./util/util";
import {getElectrifiedApp, t} from "./globals";
import _ from "underscore"
import {Button, ButtonGroup, Checkbox, Icon, Menu, MenuItem, Popover, Position} from "@blueprintjs/core";
import React from "react";
import {bind, useWatchedState, watchedComponent} from "react-deepwatch";
import type {ToastMessageComponentProps} from "./ui/ToasterWrapper";

/**
 * Used for muting notifications (the user crates a filter)
 */
export type NotificationFilter = {
    classId: string;
    forType: string;
    forId: string | number;

    cache_aboutType?: string;

    /**
     * Output of {@link Notification#ui_className}
     */
    cache_ui_className?: string;

    cache_about_ui_pluralType?: string;

    /**
     * Output of target's ui_toString
     */
    cache_for_ui_string?: string;

    cache_for_faIcon?: string
}

/**
 * Has to provide some fields for the UI and
 */
export interface NotificationTarget {
    /**
     * Unique id
     */
    id: string | number,
    type: string,
    parent: NotificationTarget | undefined

    /**
     * All notifications that were produced for this item. Including muted notifications.
     * Class-id -> Notification
     */
    notifications: Map<string, Notification>

    /**
     * I.e. "disks".
     */
    ui_pluralType:string
    ui_toString: () => string

    /**
     * Font awesome icon string. Without prefix
     */
    faIcon:string
}

export type NotificationSettings = {
    muted: boolean,
}


/**
 * A (popup) notification which is mute-able = the user can switch it off.
 * Therefore it is identified by the {@link classId} and **about** an item, see {@link about}.
 * <p>
 *     Usage:
 *  </p>
 *  <pre><code>
 *      new Notification({
 *           plugin: this, // assumes this = your plugin.
 *           about: this.app.datacenter.getGuest(820)!,
 *           textContent: t`This a a sample notification`,
 *       }).registerAndShow();
 *  </code></pre>
 */
export class Notification {
    /**
     * Should be set for a better unique id and to hint the user from where this Notification came.
     */
    plugin?: Plugin;

    /**
     * About what does this notify? Set it to `getElectrifiedApp().datacenter` if you don't want to scope it
     */
    about!: NotificationTarget ;

    type: "warning" | "info" = "warning"

    /**
     * Can be either specified here, or by implementing {@see PopupComponent}
     */
    textContent?: string

    _isDestroyed = false;

    constructor(intitalValues: Partial<Notification> & Pick<Notification, "about">) {
        extend_quick(this, intitalValues);
    }

    /**
     * Adds it to the notification in about (so it will be shown in the tree, that there is a new notification). Pops it up. All only if the user has not mutet it.
     */
    registerAndShow() {
        this.about || throwError("about not set");
        const isNew = !this.about.notifications.has(this.classId);
        this.about.notifications.set(this.classId, this);
        if(isNew && !this.isMuted()) {
            getElectrifiedApp()._popupNotification(this);
        }
    }

    get className() {
        return this.constructor?.name || throwError("Could not determine class name. Please override get className");
    }

    /**
     * System wide id
     */
    get classId() {
        return `${this.plugin?.name || ""}_${this.className}`;
    }

    /**
     * Long name for displaying it in the muted-notifications table
     */
    get ui_className() {
        return this.className;
    }

    /**
     *For displaying it in the popup
     */
    get title() {
        return this.ui_className
    }

    /**
     * Description for displaying it in the muted-notifications table
     */
    get ui_classDescription() {
        return this.className;
    }

    matchesFilter(filter: NotificationFilter) {
        if(filter.classId && filter.classId !== this.classId) {
            return false;
        }

        if(!filter.forType || filter.forType === "datacenter") {
            return true;
        }

        // Check this.about:
        let about: NotificationTarget | undefined = this.about;
        while(about) {
            if(filter.forType === about.type) {
                return filter.forId === about.id;
            }
            about = about.parent;
        }
        return false;
    }

    /**
     * Like you see it in the advanced mute dialog
     */
    _getPossibleTargetScopes() {
        const result: NotificationTarget[] = [];
        for(let about: NotificationTarget | undefined = this.about;about;about = about.parent) {
            result.push(about);
        }
        return result;
    }

    isMuted() {
        return [...getElectrifiedApp().datacenterConfig.notificationSettings, ...getElectrifiedApp().userConfig.notificationSettings].some(s => this.matchesFilter(s.filter) && s.settings.muted);
    }

    async mute(target?: NotificationTarget, forAllUsers = false) {
        if(!target) {
            target = this.about;
        }

        const settings = forAllUsers?getElectrifiedApp().datacenterConfig.notificationSettings:getElectrifiedApp().userConfig.notificationSettings;
        const filter: NotificationFilter = {
            forId: target.id || throwError("item has no id set"),
            forType: target.type || throwError("item has no type set"),
            classId: this.classId,
            cache_aboutType: this.about.type,
            cache_ui_className: this.ui_className,
            cache_about_ui_pluralType: this.about.ui_pluralType,
            cache_for_ui_string: target.ui_toString(),
            cache_for_faIcon: target.faIcon,
        }
        let settingsItem = settings.find(s => _.isEqual(s.filter, filter))
        if(!settingsItem) {
            settingsItem = {filter, settings: {muted: true}};
            settings.push(settingsItem);
        }
        settingsItem.settings.muted = true;
    }

    getIcon() {
        if(this.type === "warning") {
            return <Icon icon={"warning-sign"} />
        }
        else if(this.type === "info") {
            return <Icon icon={"info-sign"} />
        }
        else {
            return <Icon icon={"info-sign"} />
        }
    }

    /**
     * React component function that shows the content (inside the notification popup).
     * @see OuterPopupComponent
     */
    Content = watchedComponent((props: {embedType: "table" | "popupMessage"}) => {
        return <div>{this.textContent}</div>
    });

    /**
     * Shows the message popup with the close and mute Buttons
     * @see Content You should rather override the {@link Content} method
     */
    OuterPopupComponent = watchedComponent((props: ToastMessageComponentProps) => {
        const state = useWatchedState(new class {
            muteForAllUsers = false;
        })

        const possibleTargetScopes = this._getPossibleTargetScopes().reverse();

        return <div style={{width: "600px"}}>
            <div style={{display: "flex", flexDirection: "row", alignItems: "center", gap: "8px", marginBottom: "16px"}}>
                {this.getIcon()}
                <div style={{flexGrow: 1}}><strong>{this.title}</strong></div>
                <Button variant={"minimal"} icon={"small-cross"} onClick={() => props.close()}></Button>
            </div>

            <this.Content embedType={"popupMessage"}/>

            <div style={{display: "flex", alignItems: "center", gap: "8px"}}>
                <div style={{flexGrow: 1}}></div>
                {props.moreToastsWaiting > 0 && <div style={{textAlign: "right"}}><i>{t`${props.moreToastsWaiting} more notifications`}</i></div>}
                {/* Mute button*/}
                <ButtonGroup>
                    <Button icon={<span className={"fa fa-bell-slash"} style={{width: "14px"}}/>} onClick={() => spawnWithErrorHandling(async () => {await this.mute(undefined, state.muteForAllUsers); props.close()})}>Mute</Button>
                    <Popover position={Position.BOTTOM_LEFT} usePortal={false} content={
                        <div style={{width: "600px", display: "flex", flexDirection: "column", gap: "0px"}}>
                            <div style={{paddingLeft: "8px", paddingRight:"8px", paddingTop:"8px"}}>

                                <div style={{display: "flex", alignItems: "top", gap: "0px"}}><Checkbox {...bind(state.muteForAllUsers)}/><div><strong>{t`Mute for all users.`}</strong><i> {t`This stores the following choice for all users`}</i>{/*<InfoTooltip usePortal={false}><span>todo</span></InfoTooltip>*/}.</div></div>
                                <div><HoverTooltip interactionKind={"click-target"} tooltip={<div style={{paddingBottom: "50px"}}>{t`You will find it under: Settings > Notifications`}<br/><img src="../../images/screenshot_notification_settings.png"/></div>} showHand={true} placement={"top"} ><i><Icon icon={"info-sign"}/> {t`Where to un-mute it later?`}</i></HoverTooltip></div>


                                <hr style={{marginTop: "8px", marginBottom: "8px"}}/>
                                {possibleTargetScopes.length >1 && <h3 style={{margin: 0}}>{t`Please make the choice, how broad you want to mute`}</h3>}
                            </div>
                            {possibleTargetScopes.length >1 &&
                            <Menu>
                                {
                                    possibleTargetScopes.map(target => {
                                        return <MenuItem key={target.type} icon={<span className={`fa fa-${target.faIcon}`}/>} text={target === this.about?t`Mute "${this.ui_className}" notifications for ${target.ui_toString()}` : t`Mute "${this.ui_className}" notifications for all ${this.about.ui_pluralType} under ${target.ui_toString()}`} onClick={() => spawnWithErrorHandling(async () => {await this.mute(target, state.muteForAllUsers); props.close()})}/>
                                    })
                                }
                            </Menu>
                            }

                        </div>
                    }><Button rightIcon="caret-down"></Button></Popover>
                </ButtonGroup>
            </div>
        </div>
    });

    /**
     *  Hides and unregisters this
     */
    delete() {
        this.about.notifications.delete(this.classId);
        this._isDestroyed = true;
    }

    get isDestroyed() {
        return this._isDestroyed;
    }
}