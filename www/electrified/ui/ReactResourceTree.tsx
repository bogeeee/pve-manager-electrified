import React, {CSSProperties, MutableRefObject, ReactNode, useEffect, useRef, MouseEvent} from "react";
import {bind, binding, load, READS_INSIDE_LOADER_FN, useWatchedState, watched, watchedComponent} from "react-deepwatch"
import {Button, ButtonGroup, Classes, Icon, InputGroup, Intent, NumericInput} from "@blueprintjs/core";
import "@blueprintjs/core/lib/css/blueprint.css";
import "@blueprintjs/icons/lib/css/blueprint-icons.css";
import {getElectrifiedApp, t} from "../globals";
import "../styles.css"
import {Guest} from "../model/Guest";
import {Node} from "../model/Node";
import {
    coolBackgroundMask, coolBackgroundMask_remove,
    getUniqueName, highest, HoverTooltip, ignoreErr,
    ObjectHTMLSelect,
    RememberChoiceButton,
    RetryableError,
    retryTilSuccess,
    showBlueprintDialog, showMuiDialog,
    sleep,
    throwError,
    toError
} from "../util/util";
import {Pool} from "../model/Pool";
import {Storage} from "../model/Storage"
import {retsync2promise} from "proxy-facades/retsync";
import {Qemu} from "../model/Qemu";
import ex = CSS.ex;
import {TreeColumn} from "../Plugin";
import {DialogActions, DialogContent, DialogContentText} from "@mui/material";
import type {Datacenter} from "../model/Datacenter";

/**
 * The Tree-Table body in the pve resource tree (=classicResourceTree)
 * plays together with it = controlled in both directions
 */
export const ReactResourceTree = watchedComponent((props: {classicResourceTree: any, onNodeClick: (node: TreeDataNode) => void, onNodeDoubleClick: (node: TreeDataNode, event: any) => void, onNodeContextMenu: (node: TreeDataNode, event: any) => Promise<void>}) => {
    const app = getElectrifiedApp();
    const classicResourceTree = props.classicResourceTree;

    // Hand the tree state to classicResourceTree.reactTreeState:
    const treeStateRef = useRef();
    useEffect(() => {
        classicResourceTree.reactTreeState = treeStateRef.current;
    },[treeStateRef.current])



    const getIconCls = (node:TreeDataNode) => {
        try {
            let iconClass = PVE.Utils.get_object_icon_class(node.data.type, node.data);
            if (node.id === "root") {
                iconClass = `fa-server ${iconClass}`
            }

            // Handle extended / more electrified states:
            if (app.initialized) {
                let item = app.datacenter._getItemForResourceRecord(node.data);
                if (item !== null && item instanceof Guest) {
                    item = watched(item);
                    if (item.status_extended === "shutting_down") {
                        iconClass += " shutting_down";
                    }
                    if (item.status_extended === "rebooting") {
                        iconClass += " rebooting";
                    }
                }
            }
            return iconClass;
        }
        catch (e) {
            return "fa-exclamation"
        }
    }

    const getToolTip = (node:TreeDataNode) => {
        return classicResourceTree.getToolTip(node.data);
    }

    const treeColumn = {
        width: classicResourceTree.visibleColumns[0].width,
        CellComponent: watchedComponent((props: {node: TreeDataNode}) => {
            return <span dangerouslySetInnerHTML={{ __html: classicResourceTree.visibleColumns[0].initialConfig.renderer(undefined, undefined, props.node) }} /> ;
        })
    };
    const cols = [treeColumn, ...classicResourceTree.visibleColumns.slice(1).map((col: any) => {
        const electrifiedPluginColumn = col.initialConfig.electrifiedPluginColumn;
        return {
            key: col.initialConfig.columnId,
            width: col.width,
            cellStyle: col.cellStyle,
            CellComponent: getElectrifiedApp()._createResourceTreeCellComponent(electrifiedPluginColumn)
        }
    })]

    return <div className="x-tree-view x-fit-item x-tree-view-default x-unselectable x-scroller" role="rowgroup" tabIndex={0} style={{overflow: "hidden auto", margin: "0px", width: "100%", height: "100%"}}>
        <div className="x-grid-item-container" role="presentation" style={{width: "100%", transform: "translate3d(0px, 0px, 0px)"}}>
            <TreeTable root={props.classicResourceTree.store.root} getIconCls={getIconCls} getToolTip={getToolTip} cols={cols} stateRef={treeStateRef} onNodeClick={props.onNodeClick} onNodeDoubleClick={props.onNodeDoubleClick} onNodeContextMenu={props.onNodeContextMenu}/>
        </div>
        <div className="x-tab-guard x-tab-guard-after" tabIndex={-1} data-tabindex-value="0" data-tabindex-counter="1"/>
    </div>
});

/**
 * Matches the Ext.js Ext.data.Model interface
 */
class TreeDataNode {
    id!: string;
    /**
     * The item
     */
    data: any;
    childNodes: TreeDataNode[] = [];

    constructor(initialFields?: Partial<TreeDataNode>) {
        if(initialFields) {
            Object.assign(this, initialFields);
        }
    }
}

/**
 * Shows a tree with additional columns. Only the body / not the header.
 *
 * Usage Example:
 * Example:

 const TreeCell = watchedComponent((props: {item: TreeDataNode}) => {
    return <div>The cell for {props.item.id}</div>
});

 const OuterComponent = watchedComponent((props: {}) => {

    const root = new TreeDataNode({
        id: "root",
        childNodes: [new TreeDataNode({id: "A"}), new TreeDataNode({id: "B"})]
    })

    const treeColumn = {
        width: classicResourceTree.visibleColumns[0].width,
        CellComponent: watchedComponent((props: {node: TreeDataNode}) => {
            // columns[0].initialConfig
            return <span dangerouslySetInnerHTML={{ __html: classicResourceTree.columnDefs[0].renderer(undefined, undefined, props.node) }} /> ;
        })
    };
    const cols = [{
        key: "treeColumn", // give every column a unique key
        width: 200,
        CellComponent: TreeCell
    }]

    const getIconCls = (node) => {
        return "fa-server"
    }

    return <TreeTable root={root} getIconCls={getIconCls} cols={cols} />
}
 *
 *
 * Params:
 * stateRef: gets filled with the state. So this is a cheap way of controlling it from the non-react outside world
 */
export const TreeTable = watchedComponent((props: {root: TreeDataNode, stateRef: MutableRefObject<any>, onNodeClick?: (node: TreeDataNode) => void, onNodeDoubleClick?: (node: TreeDataNode, event: any) => void, onNodeContextMenu?: (node: TreeDataNode, event: any) => Promise<void>, getIconCls:(node:TreeDataNode) => string, getToolTip?: (node:TreeDataNode) => ReactNode, cols: {key: string, width: number, cellStyle?: CSSProperties, CellComponent: (props: {node: TreeDataNode}) => ReactNode}[] }) => {
    const state = useWatchedState(new class {
        expandedIds= new Set<string>();
        selectedId?: string = undefined;

        /**
         * We don't act on events, so this is a quick and dirty way instead
         */
        selectedId_scrollIntoView = false;

        selectId(id: string, scrollIntoView: boolean) {
            hoverCleanup();
            this.selectedId = id;
            this.selectedId_scrollIntoView = scrollIntoView;
        }
    })
    props.stateRef.current = state;

    const selectedHtmlRowRef = useRef<HTMLElement>()

    //const hoveredHtmlRowRef = useRef<HTMLElement>()
    const hoverCleanupFns = useRef<(() => void)[]>([]) // Called when hovering another row or when the context menu is finished
    const idWhereContextMenuIsShowingRef = useRef<string | undefined>(); // Flag it as shown so the row stays hovered. TODO: use the actual id and an effect to survive rerenders

    useEffect(() => {
        if(state.selectedId_scrollIntoView) {
            selectedHtmlRowRef.current?.scrollIntoView({block: "end"});
        }
    },[state.selectedId, state.selectedId_scrollIntoView])

    // Set the cool background for the selected row:
    useEffect(() => {
        const selectedHtmlRow = selectedHtmlRowRef.current;

        if(selectedHtmlRow) {
            coolBackgroundMask(selectedHtmlRow, "selected");
        }

        return function cleanUp() {
            if(selectedHtmlRow) {
                coolBackgroundMask_remove(selectedHtmlRow);
            }
        }
    })


    const isLeaf = (node: TreeDataNode) => node.childNodes.length === 0;
    const isFixedExpaned = (node: TreeDataNode) => node.id === props.root.id || (props.root.childNodes.length === 1 && node.id === props.root.childNodes[0].id); // Always expand root and single childs under root
    const isExpanded = (node: TreeDataNode) => state.expandedIds.has(node.id) || isFixedExpaned(node);
    const expand  = (node: TreeDataNode) => state.expandedIds.add(node.id);
    const collapse  = (node: TreeDataNode) => state.expandedIds.delete(node.id)
    const isSelected  = (node: TreeDataNode) => state.selectedId === node.id;
    const isContextMenuShown = () => idWhereContextMenuIsShowingRef.current !== undefined;
    var hoverCleanup = () => {hoverCleanupFns.current.forEach(f=>f());hoverCleanupFns.current = []}

    const onMouseEnter = (node: TreeDataNode, event: MouseEvent<any, any>) => {
        const rowElement = event.currentTarget;
        if(!isSelected(node)) {
            coolBackgroundMask(rowElement, "hovered")
            hoverCleanupFns.current.push(() => coolBackgroundMask_remove(rowElement))
        }

    }

    const onMouseLeave = (node: TreeDataNode, event: MouseEvent<any, any>) => {
        hoverCleanup();
    }

    const onContextMenu = async (node: TreeDataNode, event: MouseEvent<any, any>) => {
        event.preventDefault();
        const rowElement: HTMLElement = event.currentTarget;
        if(props.onNodeContextMenu) {
            rowElement.classList.add("treeRow-row-contextMenu")
            idWhereContextMenuIsShowingRef.current = node.id;
            await props.onNodeContextMenu?.(node, event)
            idWhereContextMenuIsShowingRef.current = undefined;
            rowElement.classList.remove("treeRow-row-contextMenu");
        }

    };

    // Determine treeRows
    const treeRows: {level: number, node: TreeDataNode}[] = [];
    const walk = (node: TreeDataNode, level: number) => {
        treeRows.push({level, node});
        if(isExpanded(node)) {
            node.childNodes.forEach(c => walk(c, level+1));
        }
    }
    walk(props.root, 0)

    function repeat<T>(times: number, fn: (i:number) => T) {
        const result:T[] = [];
        for(let i =0;i<times;i++) {
            result.push(fn(i));
        }
        return result;
    }

    return <>
        {
            treeRows.map(row => {
                const node = row.node;
                const isRoot = row.level === 0;
                const TreeCellComponent = props.cols[0].CellComponent;
                return <table key={node.id} ref={isSelected(node)?selectedHtmlRowRef as any:undefined} role="presentation" data-recordindex="0" className={`x-grid-item`} cellPadding="0" cellSpacing="0" style={{ width:0}} onClick={() => {state.selectId(node.id,false); setTimeout(() => {props.onNodeClick?.(node); })}} onDoubleClick={(event) => {props.onNodeDoubleClick?.(node,event)}} onContextMenu={(event) => onContextMenu(node, event)} onMouseEnter={(event) => onMouseEnter(node, event)} onMouseLeave={(event) => onMouseLeave(node, event)}>
                    <tbody>
                        <tr className={`x-grid-tree-node${isLeaf(node)?"-leaf":(isExpanded(node)?"-expanded":"")}  x-grid-row ${isSelected(node)?"x-grid-row-selected":""}`} role="row" data-qtip="" data-qtitle="" aria-level={row.level+1} aria-expanded={isExpanded(row.node)}>
                            {/* Tree column */}
                            <td key={"treeColumn"} className="x-grid-cell x-grid-td x-grid-cell-treecolumn x-grid-cell-first x-unselectable" style={{width:`${props.cols[0].width || throwError("width not set")}px`}} role="gridcell" tabIndex={-1}>
                                <div unselectable="on" className="x-grid-cell-inner x-grid-cell-inner-treecolumn" style={{textAlign: "left"}}>
                                    {/* Spacer / indent: */}
                                    {repeat(row.level, (i) => <div key={`spacer${i}`} className=" x-tree-elbow-img x-tree-elbow-empty" role="presentation"/>)}

                                    {isLeaf(node) && <div className=" x-tree-elbow-img x-tree-elbow" role="presentation"/>}

                                    {/* Expand/Collapse: */}
                                    {!isLeaf(node) && !isFixedExpaned(node) && isExpanded(row.node) && <div className=" x-tree-elbow-img x-tree-elbow-end-plus x-tree-expander" role="presentation" onClick={() => collapse(node)}/>}
                                    {!isLeaf(node) && !isFixedExpaned(node) && !isExpanded(row.node) && <div className=" x-tree-elbow-img x-tree-elbow-plus x-tree-expander" role="presentation" onClick={() => expand(node)}/>}

                                    {/* Icon: */}
                                    <HoverTooltip tooltip={props.getToolTip?.(node)} showHand={false}>
                                        <div role="presentation" className={`x-tree-icon x-tree-icon-custom x-tree-icon${isLeaf(node)?"-leaf":(isExpanded(node)?"-parent-expanded":"-parent")} fa ${props.getIconCls(node)}`}/>
                                    </HoverTooltip>

                                    {/* Text: */}
                                    <span className="x-tree-node-text "><TreeCellComponent node={node}/></span></div>

                            </td>

                            {/* Other columns: */}
                            {props.cols.slice(1).map(col => {
                                return <td key={col.key} className="x-grid-cell x-grid-td x-unselectable" style={{width: `${col.width}px`}} role="gridcell" tabIndex={-1}>
                                    <div unselectable="on" className="x-grid-cell-inner " style={{textAlign: "left", height: "24px", transform: "translate(0)", ...(col.cellStyle || {})}}>
                                        <col.CellComponent node={node}/>
                                    </div>
                                </td>
                            })}
                            <td key={"spacerEnd"} style={{width: "11px"}}/>

                        </tr>
                    </tbody>
                </table>
            })
        }
    </>
});

/**
 * See i.e. the config for the ram bars in the resource tree
 */
export class ValueBarTreeColumnConfig {
    nodeScale: "self" | "highestNodeMax" | "datacenterMax" = "self";
    guestsScale: "highestGuestActual" | "highestGuestMax" | "highestSiblingActual" | "highestSiblingMax" | "parentActual" | "parentMax" = "highestGuestMax";
    poolsScale: "highestPool" | "datacenterMax" = "highestPool";
    showUnusedRamBackground= {
        datacenter: true,
        pool: true,
        node: true,
        guest: true,
    };
    styleVariant: string = "A"
}

/**
 * Use this helper to simply create **bar** columns in the resource tree, like the "Mem bars".
 * For usage a usage example, see {@link ElectrifiedFeaturesPlugin#getMemBarTreeColumn}
 * @param colDef
 */
export function createValueBarTreeColumn(colDef: {
    valueFn:(item: ValueBarItem) => number | undefined,
    maxValueFn:(item: ValueBarItem) => number | undefined,
    formatTextFn: (value: number) => string,
    configKey: string,
} & Omit<TreeColumn, "cellRenderFn" | "cellStyle">): TreeColumn {
    const app = getElectrifiedApp();
    return  {
        cellStyle: {paddingTop: "5px", paddingBottom: "5px"},
        cellRenderFn: (props: { item: object, rowIndex: number, colIndex: number, rawItemRecord: Record<string, unknown>, node: any }) => {
            const item = props.item;
            //@ts-ignore
            const config = watched(app.userConfig)[colDef.configKey] as ValueBarTreeColumnConfig;
            const datacenter =watched(app.datacenter);
            if(item instanceof app.classes.model.Datacenter) {
                const itemValue = colDef.valueFn(item) || 0;
                const itemMax = colDef.maxValueFn(item) as number;
                return getBars(itemValue, config.showUnusedRamBackground.datacenter?itemMax:undefined, itemMax)
            }
            else if(item instanceof app.classes.model.Node) {
                const itemValue = colDef.valueFn(item) || 0;
                const itemMax = colDef.maxValueFn(item) as number;
                let referenceMax: number | undefined = undefined;
                if(config.nodeScale === "self") {
                    referenceMax = itemMax;
                }
                else if(config.nodeScale === "highestNodeMax") {
                    referenceMax = highest(datacenter.nodes.map(n => colDef.maxValueFn(n) || throwError(`colDef.maxValueFn did not return a value for node`)))
                }
                else if(config.nodeScale === "datacenterMax") {
                    referenceMax = colDef.maxValueFn(datacenter) || throwError(`colDef.maxValueFn did not return a value for datacenter`);
                }
                else {
                    throw new Error(`Invalid config value for nodeScale: ${config.nodeScale}. Try to clear your browser's localstorage (key: "electrified_config") and reload the page`);
                }
                return getBars(itemValue, config.showUnusedRamBackground.node?itemMax:undefined, referenceMax)
            }
            else if (item instanceof app.classes.model.Pool) {
                const itemValue = colDef.valueFn(item) || 0;
                const itemMax = colDef.maxValueFn(item) as number;
                let referenceMax: number | undefined = undefined;
                if(config.poolsScale === "datacenterMax") {
                    referenceMax = colDef.valueFn(datacenter) || throwError(`colDef.valueFn did not return a value for datacenter`);
                }
                else if(config.poolsScale === "highestPool") {
                    referenceMax = highest(datacenter.pools.map(p => colDef.maxValueFn(p) || colDef.valueFn(p) || 0));
                }
                else {
                    throw new Error(`Invalid config value for poolsScale: ${config.poolsScale}. Try to clear your browser's localstorage (key: "electrified_config") and reload the page`);
                }
                return getBars(itemValue, config.showUnusedRamBackground.pool?itemMax:undefined, referenceMax)
            }
            else if (item instanceof app.classes.model.Guest) {
                const itemValue = colDef.valueFn(item) || 0;
                const itemMax = colDef.maxValueFn(item) as number;
                let referenceMax: number | undefined = undefined;
                const parent = datacenter._getItemForResourceRecord(props.node.parentNode.data) as Node | Pool;
                const siblings = props.node.parentNode.childNodes.map((n: any) => ignoreErr(() => datacenter._getItemForResourceRecord(n.data) as Guest | unknown) /* ignoreErr for the case that a guest was cloned and is not yet found. TODO: make errors recoverabe in react-deepwatch */).filter((i:unknown) => i !== null && i instanceof app.classes.model.Guest) as Guest[]
                if(config.guestsScale === "highestGuestActual") {
                    referenceMax = highest(datacenter.nodes.flatMap(n => n.guests).map(g => colDef.valueFn(g) || 0));
                }
                else if(config.guestsScale === "highestGuestMax") {
                    referenceMax = highest(datacenter.nodes.flatMap(n => n.guests).map(g => colDef.maxValueFn(g) || 0));
                }
                else if(config.guestsScale === "highestSiblingActual") {
                    referenceMax = highest(siblings.map(g => colDef.valueFn(g) || 0));
                }
                else if(config.guestsScale === "highestSiblingMax") {
                    referenceMax = highest(siblings.map(g => colDef.maxValueFn(g) || 0));
                }
                else if(config.guestsScale === "parentActual") {
                    referenceMax = colDef.valueFn(parent);
                }
                else if(config.guestsScale === "parentMax") {
                    referenceMax = colDef.maxValueFn(parent) || colDef.valueFn(parent);
                }
                else {
                    throw new Error(`Invalid config value for guestsScale: ${config.guestsScale}. Try to clear your browser's localstorage (key: "electrified_config") and reload the page`);
                }
                return getBars(itemValue, config.showUnusedRamBackground.guest?itemMax:undefined, referenceMax)
            }
            else {
                return undefined;
            }
            type Layer = {start: number, amount: number, cssClass: string, css?: CSSProperties};

            function getBars(valueForThisItem: number, maxForThisItem: number | undefined, referenceMax: number | undefined) {
                if(valueForThisItem === 0) {
                    return;
                }
                const text = colDef.formatTextFn(valueForThisItem)
                const toolTip = maxForThisItem?`${colDef.formatTextFn(valueForThisItem)} / ${colDef.formatTextFn(maxForThisItem)}`:undefined
                const getContainerClassName = (hasBackround: boolean) => `cpu-bars-container ${config.styleVariant?`bars-style-${config.styleVariant}`:""} cpu-bars-container-${hasBackround?"with":"no"}-background`;

                if(!referenceMax) {
                    // Show just text without bars:
                    return <HoverTooltip tooltip={toolTip} showHand={false} fullDiv={true}><div className={getContainerClassName(!!maxForThisItem)} style={{width: "100%"}}>{text}</div></HoverTooltip>
                }

                const layers = [{start: 0, amount: valueForThisItem /referenceMax, cssClass: "cpu-bar-cpu"}]
                if(maxForThisItem) {
                    layers.push({start: valueForThisItem /referenceMax, amount: (maxForThisItem - valueForThisItem) / referenceMax, cssClass: "cpu-bar-unused"});
                }
                {
                    const maxval = highest(layers.map(l => l.start + l.amount));
                    if (maxval < 1) {
                        layers.push({start: maxval, amount: 1 - maxval, cssClass: "cpu-bar-fill-empty"})
                    }
                }
                let layerKey = 0;
                return <HoverTooltip tooltip={toolTip} showHand={false} fullDiv={true}><div className={getContainerClassName(!!maxForThisItem)} style={{width: "100%"}}><div className="cpu-bar" style={{height:"100%", width: "100%"}}>{layers.map(layer => {
                    return <div key={layerKey++} className={layer.cssClass} style={{position: "absolute", width: "100%", height: "100%", clipPath: `inset(0 ${(1 - layer.start - layer.amount) * 100}% 0 ${layer.start * 100}%)`, overflow: "hidden", paddingLeft: "4px", paddingRight: "4px"}}>
                            {text}
                        </div>
                })}
                    {/* Output at least a super small 1px wide bar for valueForThisItem. Otherwise when the value is too small and only the background is shown, this looks confusing*/}
                    <div key="min1pxValue" className="cpu-bar-cpu" style={{position: "absolute", width: "1px", height: "100%"}}/>
                </div></div></HoverTooltip>
            }
        },
        showConfig() {
            const result = showMuiDialog(t`${colDef.text} configuration`, {}, (props) => {
                //@ts-ignore
                const config = watched(app.userConfig)[colDef.configKey] as ValueBarTreeColumnConfig;
                return <React.Fragment>
                    <DialogContent>
                        <DialogContentText>

                            <h3 style={{margin: "0px"}}>{t`Background`}</h3> {t`Show unused/free background for`}:<br/>
                            {[{key: "datacenter", text: t`Datacenter`}, {key: "pool", text: t`Pools`}, {key: "node", text: t`Nodes`}, {key: "guest", text: t`Guests`}].map(item =>
                                <div>&#160;<input type="checkbox" {...bind((config.showUnusedRamBackground as any)[item.key])} /> {item.text}</div>
                            )}

                            <br/>{t`Bar scale for nodes`}:&#160;
                            <select {...bind(config.nodeScale)}>
                                <option key="self" value={"self"}>{t`Node's max value`}</option>
                                <option key="highestNodeMax" value={"highestNodeMax"}>{t`Relative to highest node's max value`}</option>
                                <option key="datacenterMax" value={"datacenterMax"}>{t`Relative to datacenter's max value`}</option>
                            </select>

                            <br/>{t`Bar scale for pools`}:&#160;
                            <select {...bind(config.poolsScale)}>
                                <option key="highestPool" value={"highestPool"}>{t`Relative to highest pool's value (sum of guests' actual)`}</option>
                                <option key="datacenterMax" value={"datacenterMax"}>{t`Relative to datacenter's max value`}</option>
                            </select>

                            <br/>{t`Bar scale for guests`}:&#160;
                            <select {...bind(config.guestsScale)}>
                                <option key="highestGuestActual" value={"highestGuestActual"}>{t`Relative to highest guest(datacenter wide)'s actual value`}</option>
                                <option key="highestGuestMax" value={"highestGuestMax"}>{t`Relative to highest guest(datacenter wide)'s max value`}</option>
                                <option key="highestSiblingActual" value={"highestSiblingActual"}>{t`Relative to highest sibling's actual value`}</option>
                                <option key="highestSiblingMax" value={"highestSiblingMax"}>{t`Relative to highest sibling's max value`}</option>
                                <option key="parentActual" value={"parentActual"}>{t`Relative to parent (node/pool)'s actual value`}</option>
                                <option key="parentMax" value={"parentMax"}>{t`Relative to parent (node/pool)'s max value (if available)`}</option>
                            </select>

                            <br/>{t`Bar style`}:&#160;
                            <select {...bind(config.styleVariant)}>
                                <option key="default" value={undefined}>Default</option>
                                <option key="B" value={"B"}>B</option>
                                <option key="D" value={"D"}>D</option>
                            </select>
                        </DialogContentText>
                    </DialogContent>
                    <DialogActions>
                        <Button type="submit" onClick={() => props.resolve(true)} >{t`Close`}</Button>
                    </DialogActions>
                </React.Fragment>
            });
        },
        ...colDef,
    } as (TreeColumn /* my older Webstorm marks this as error otherwise */)
}

type ValueBarItem = Datacenter | Node | Pool | Guest

//@ts-ignore
var Ext = window.Ext;
//@ts-ignore
var PVE = window.PVE;
//@ts-ignore
var Proxmox = window.Proxmox;