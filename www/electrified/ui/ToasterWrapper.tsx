import {AsyncConstructableClass} from "../util/AsyncConstructableClass";

import {
    Button, ButtonGroup, Checkbox,
    Icon,
    Menu,
    MenuItem,
    OverlayToaster, Placement,
    Popover,
    Position,
    Toaster,
    ToastProps,
    Tooltip
} from "@blueprintjs/core";
import React, {ReactNode} from "react";
import {t} from "../globals";
import {ErrorState, HoverTooltip, InfoTooltip, isPVEDarkTheme, muiTheme} from "../util/util";
import {useWatchedState, watched, watchedComponent} from "react-deepwatch";
import {ThemeProvider} from "@mui/material";
import {ErrorBoundary} from "react-error-boundary";

type ToastMessage = {
    Component: (props: ToastMessageComponentProps) => ReactNode,
    /**
     * Returns if this enqueued notification got obsolete in the meanwhile. So it won't be shown
     */
    isObsolete: () => boolean
}

export type ToastMessageComponentProps = {moreToastsWaiting: number, close: () => void};

/**
 * Wrapper for Blueprint's Toaster because that one does not handle showing multiple notifications at one very good.
 */
export class ToasterWrapper extends AsyncConstructableClass {
    bpToaster!: Toaster;
    currentMessageId?: string;
    moreToastsWaiting: ToastMessage[] = [];
    protected async constructAsync(): Promise<void> {
        await super.constructAsync();
        this.bpToaster = await OverlayToaster.create({ position: "bottom", maxToasts: 1 ,className:isPVEDarkTheme()?"bp6-dark":undefined});
    }

    _forceClearBpToaster() {
        this.bpToaster.show({message: "", timeout: 1})
        this.currentMessageId = undefined;
    }

    _showNext() {
        // Find next message:
        let next: ToastMessage | undefined = undefined;
        while((!next || next.isObsolete()) && this.moreToastsWaiting.length > 0) {
            next = this.moreToastsWaiting.shift()!;
        }

        if(!next || next.isObsolete()) {
            if(this.currentMessageId) {
                this._forceClearBpToaster();
            }
            return;
        }

        // Show:
        this.currentMessageId = this.bpToaster.show({
            message: <this.MessageComponent message={next}/>,
            isCloseButtonShown: false,
            timeout: 0,
            onDismiss: (didTimeoutExpire: boolean) => {
                //this.currentMessageId = undefined;
                //this._showNext();
            }
        });
    }

    show(message: ToastMessage) {
        this.moreToastsWaiting.push(message);
        if(!this.currentMessageId) { // None currently showing?
            this._showNext();
        }
    }

    MessageComponent= watchedComponent( (props: {message: ToastMessage}) => {
        const moreToastsWaiting = watched(this.moreToastsWaiting);
        const close =() => {
            this._showNext();
        }

        return <ThemeProvider theme={muiTheme}>
                    <ErrorBoundary fallbackRender={ErrorState}>
                        <div className={isPVEDarkTheme()?"bp6-dark":undefined}>

                            <props.message.Component close={close} moreToastsWaiting={this.moreToastsWaiting.filter(t => !t.isObsolete()).length}/>
                        </div>
                    </ErrorBoundary>
        </ThemeProvider>
    });
}