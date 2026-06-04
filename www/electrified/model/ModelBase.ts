import {AsyncConstructableClass} from "../util/AsyncConstructableClass";
import {invalidateObject} from "proxy-facades";
import {getElectrifiedApp} from "../globals";
import {ClassOf, isSubclassOf} from "../util/util";

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
     * Marker if you want to call this method manually later
     */
    _skip_handleAddedAndInitialized?: boolean

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

    /**
     * Cleans up resources after this object was deleted. Calls super.cleanUp() as **last** statement
     */
    _cleanup() {
        invalidateObject(this, `${this} has been deleted`);
    }

    static async create<C extends AsyncConstructableClass>(this: new () => C, initialFields?: Partial<C>): Promise<C> {
        const result = await super.create(initialFields) as any as ModelBase;

        if(!result._skip_handleAddedAndInitialized) {
            setTimeout(() => {
                if (objectIsDestroyed(result)) { // This object seems to have had a very short lifetime. I.e. it was created and then immediately killed by "presserve"
                    return;
                }
                result._handleAddedAndInitialized();
            }, 0)
        }

        return result as any as C;
    }


    /**
     * Called after this model was created and added to the parent and is fully initialized
     */
    _handleAddedAndInitialized() {
        getElectrifiedApp().diagnosisTasksClasses.forEach(taskClass => {
            if(isSubclassOf(this.constructor as ClassOf<any>, taskClass.runForEach)) { // Task should be run for each instance of this class?
                taskClass._createAndScheduleTask(this);
            }
        })
    }

    get clazz(): this["classType"] {
        return this.constructor as any;
    }
}

/**
 * Checks, if obj is invalidated through invalidateObject (by preserve)
 * @param obj
 */
export function objectIsDestroyed(obj: ModelBase) {
    try {
        //@ts-ignore
        obj.updateListeners // Just access the property
        return false;
    }
    catch (e) {
        return true;
    }
}