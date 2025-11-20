import {AsyncConstructableClass} from "../util/AsyncConstructableClass";

export class ModelBase extends AsyncConstructableClass {
    protected updateListeners = new Set<(() => void)>();

    /**
     * Calls the listener whenever this is changed or after a regular data poll from the server (with actual changes).
     * <p>
     *     Change is meant in a shallow sense. For child items, that are class instances you need to register and onChange listener there
     *  <p/>
     * @param listener
     */
    onUpdate(listener: () => void) {
        this.updateListeners.add(listener);
    }

    offUpdate(listener: () => void) {
        this.updateListeners.delete(listener);
    }

    /**
     * Internal: Calls the onUpdate listeners
     * @see #onUpdate
     */
    _fireUpdate() {
        this.updateListeners.forEach(l => l());
    }
}