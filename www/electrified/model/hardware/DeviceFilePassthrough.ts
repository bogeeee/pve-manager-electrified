import {Hardware} from "./Hardware";
import {throwError} from "../../util/util";
import {t} from "../../globals";

export class DeviceFilePassthrough extends Hardware {

    get filePath() {
        this.rawConfigString || throwError("rawConfigString empty");
        return /^[^,:]*/.exec(this.rawConfigString)![0];
    }

    get ui_type() {
        return t`device`;
    }
    get ui_pluralType() {
        return t`devices`;
    }

    ui_toString() {
        return t`device ${this.toString()} in ${this.parent.ui_toString()}`;
    }

    conflictsWith_whenGuestIsRunning(other: this) {
        return (this.filePath === other.filePath)?this.filePath:false;
    }

    faIcon = "pve-itype-icon-pci";

    get iconClass(): string {
        return "pve-itype-icon-pci";
    }
}