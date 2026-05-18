import React, {CSSProperties, MutableRefObject, ReactNode, useEffect, useRef} from "react";
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
    getUniqueName, HoverTooltip,
    ObjectHTMLSelect,
    RememberChoiceButton,
    RetryableError,
    retryTilSuccess,
    showBlueprintDialog,
    sleep,
    throwError,
    toError
} from "../util/util";
import {Pool} from "../model/Pool";
import {Storage} from "../model/Storage"
import {retsync2promise} from "proxy-facades/retsync";
import {Qemu} from "../model/Qemu";
import ex = CSS.ex;

/**
 * The Tree-Table body in the pve resource tree (=classicResourceTree)
 * plays together with it = controlled in both directions
 */
export const ReactResourceTree = watchedComponent((props: {classicResourceTree: any, onNodeClick: (node: TreeDataNode) => void, onNodeDoubleClick: (node: TreeDataNode, event: any) => void, onNodeContextMenu: (node: TreeDataNode, event: any) => void}) => {

    const classicResourceTree = props.classicResourceTree;

    // Hand the tree state to classicResourceTree.reactTreeState:
    const treeStateRef = useRef();
    useEffect(() => {
        classicResourceTree.reactTreeState = treeStateRef.current;
    },[treeStateRef.current])



    const getIconCls = (node:TreeDataNode) => {
        let iconClass = PVE.Utils.get_object_icon_class(node.data.type, node.data);
        if(node.id === "root") {
            iconClass = `fa-server ${iconClass}`
        }
        return iconClass;
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
export const TreeTable = watchedComponent((props: {root: TreeDataNode, stateRef: MutableRefObject<any>, onNodeClick?: (node: TreeDataNode) => void, onNodeDoubleClick?: (node: TreeDataNode, event: any) => void, onNodeContextMenu?: (node: TreeDataNode, event: any) => void, getIconCls:(node:TreeDataNode) => string, getToolTip?: (node:TreeDataNode) => ReactNode, cols: {key: string, width: number, CellComponent: (props: {node: TreeDataNode}) => ReactNode}[] }) => {
    const state = useWatchedState(new class {
        expandedIds= new Set<string>();
        selectedId?: string = undefined;

        /**
         * We don't act on events, so this is a quick and dirty way instead
         */
        selectedId_scrollIntoView = false;

        selectId(id: string, scrollIntoView: boolean) {
            this.selectedId = id;
            this.selectedId_scrollIntoView = scrollIntoView;
        }
    })
    props.stateRef.current = state;

    const selectedHtmlRowRef = useRef<HTMLElement>()

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
    const isExpanded = (node: TreeDataNode) => state.expandedIds.has(node.id);
    const expand  = (node: TreeDataNode) => state.expandedIds.add(node.id);
    const collapse  = (node: TreeDataNode) => state.expandedIds.delete(node.id)
    const isSelected  = (node: TreeDataNode) => state.selectedId === node.id;

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
                return <table key={node.id} ref={isSelected(node)?selectedHtmlRowRef as any:undefined} role="presentation" data-recordindex="0" className={`x-grid-item`} cellPadding="0" cellSpacing="0" style={{ width:0}} onClick={() => {state.selectId(node.id,false); setTimeout(() => {props.onNodeClick?.(node); })}} onDoubleClick={(event) => {props.onNodeDoubleClick?.(node,event)}}  onContextMenu={(event) => {event.preventDefault(); props.onNodeContextMenu?.(node, event)}} onMouseEnter={(event) => !isSelected(node) && coolBackgroundMask(event.currentTarget, "hovered")} onMouseLeave={(event) => !isSelected(node) && coolBackgroundMask_remove(event.currentTarget)}>
                    <tbody>
                        <tr className={`x-grid-tree-node${isLeaf(node)?"-leaf":(isExpanded(node)?"-expanded":"")}  x-grid-row`} role="row" data-qtip="" data-qtitle="" aria-level={row.level+1} aria-expanded={isExpanded(row.node)}>
                            {/* Tree column */}
                            <td key={"treeColumn"} className="x-grid-cell x-grid-td x-grid-cell-treecolumn x-grid-cell-first x-unselectable" style={{width:`${props.cols[0].width || throwError("width not set")}px`}} role="gridcell" tabIndex={-1}>
                                <div unselectable="on" className="x-grid-cell-inner x-grid-cell-inner-treecolumn" style={{textAlign: "left"}}>
                                    {/* Spacer / indent: */}
                                    {repeat(row.level, (i) => <div key={`spacer${i}`} className=" x-tree-elbow-img x-tree-elbow-empty" role="presentation"/>)}

                                    {isLeaf(node) && <div className=" x-tree-elbow-img x-tree-elbow" role="presentation"/>}

                                    {/* Expand/Collapse: */}
                                    {!isLeaf(node) &&  isExpanded(row.node) && <div className=" x-tree-elbow-img x-tree-elbow-end-plus x-tree-expander" role="presentation" onClick={() => collapse(node)}/>}
                                    {!isLeaf(node) && !isExpanded(row.node) && <div className=" x-tree-elbow-img x-tree-elbow-plus x-tree-expander" role="presentation" onClick={() => expand(node)}/>}

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
                                    <div unselectable="on" className="x-grid-cell-inner " style={{textAlign: "left"}}>
                                        <col.CellComponent node={node}/>
                                    </div>
                                </td>
                            })}

                        </tr>
                    </tbody>
                </table>
            })
        }
    </>
});

//@ts-ignore
var Ext = window.Ext;
//@ts-ignore
var PVE = window.PVE;
//@ts-ignore
var Proxmox = window.Proxmox;