import {AsyncConstructableClass} from "../util/AsyncConstructableClass";

export class ModelBase extends AsyncConstructableClass {
    /**
     * Type hint.
     * <p/>
     * In order to make your special static subclass members available via <code>this.clazz</code>, you must help typescript a bit by redefining this field with the follwing line:
     * </p>
     * <pre><code>
     *     classType!: typeof YOUR-ModelBase-SUBCLASS;
     * </code></pre>
     */
    classType!: typeof ModelBase

    protected updateListeners = new Set<(() => void)>();

    /**
     * Calls the listener whenever this is changed or after a regular data poll from the server (with no actual changes).
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

    get clazz(): this["classType"] {
        return this.constructor as any;
    }
}