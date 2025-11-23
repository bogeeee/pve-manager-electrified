/*
 * Left Treepanel, containing all the resources we manage in this datacenter: server nodes, server storages, VMs and Containers
 */
Ext.define('PVE.tree.ResourceTree', {
    extend: 'Ext.tree.TreePanel',
    alias: ['widget.pveResourceTree'],

    userCls: 'proxmox-tags-circle',

    statics: {
        typeDefaults: {
            node: {
                iconCls: 'fa fa-building',
                text: gettext('Nodes'),
            },
            pool: {
                iconCls: 'fa fa-tags',
                text: gettext('Resource Pool'),
            },
            storage: {
                iconCls: 'fa fa-database',
                text: gettext('Storage'),
            },
            sdn: {
                iconCls: 'fa fa-th',
                text: gettext('SDN'),
            },
            network: {
                iconCls: 'fa fa-globe',
                text: gettext('Network'),
            },
            qemu: {
                iconCls: 'fa fa-desktop',
                text: gettext('Virtual Machine'),
            },
            lxc: {
                iconCls: 'fa fa-cube',
                text: gettext('LXC Container'),
            },
            template: {
                iconCls: 'fa fa-file-o',
            },
            tag: {
                iconCls: 'fa fa-tag',
            },
        },
    },

    columns: [
        {
            xtype: 'treecolumn',
            flex: 1,
            dataIndex: 'text',
            renderer: function (val, meta, rec) {
                let info = rec.data;

                let text = info.text;
                let status = '';
                if (info.type === 'storage') {
                    let usage = info.disk / info.maxdisk;
                    if (usage >= 0.0 && usage <= 1.0) {
                        let barHeight = (usage * 100).toFixed(0);
                        let remainingHeight = (100 - barHeight).toFixed(0);
                        status = '<div class="usage-wrapper">';
                        status += `<div class="usage-negative" style="height: ${remainingHeight}%"></div>`;
                        status += `<div class="usage" style="height: ${barHeight}%"></div>`;
                        status += '</div> ';
                    }
                }
                if (Ext.isNumeric(info.vmid) && info.vmid > 0) {
                    if (PVE.UIOptions.getTreeSortingValue('sort-field') !== 'vmid') {
                        text = `${info.name} (${String(info.vmid)})`;
                    }
                }
                text = `<span>${status}${text}</span>`;
                text += PVE.Utils.renderTags(info.tags, PVE.UIOptions.tagOverrides);

                if (info.id === 'root' && PVE.ClusterName) {
                    text += ` (${PVE.ClusterName})`;
                }

                return (info.renderedText = text);
            },
        },
    ],

    useArrows: true,

    // private
    getTypeOrder: function (type) {
        switch (type) {
            case 'lxc':
                return 0;
            case 'qemu':
                return 1;
            case 'node':
                return 2;
            case 'sdn':
                return 3;
            case 'network':
                return 3.5;
            case 'storage':
                return 4;
            default:
                return 9;
        }
    },

    // private
    nodeSortFn: function (node1, node2) {
        let me = this;
        let n1 = node1.data,
            n2 = node2.data;

        if (!n1.groupbyid === !n2.groupbyid) {
            let n1IsGuest = n1.type === 'qemu' || n1.type === 'lxc';
            let n2IsGuest = n2.type === 'qemu' || n2.type === 'lxc';
            if (me['group-guest-types'] || !n1IsGuest || !n2IsGuest) {
                // first sort (group) by type
                let res = me.getTypeOrder(n1.type) - me.getTypeOrder(n2.type);
                if (res !== 0) {
                    return res;
                }
            }

            // then sort (group) by ID
            if (n1IsGuest) {
                if (me['group-templates'] && !n1.template !== !n2.template) {
                    return n1.template ? 1 : -1; // sort templates after regular VMs
                }
                if (me['sort-field'] === 'vmid') {
                    if (n1.vmid > n2.vmid) {
                        // prefer VMID as metric for guests
                        return 1;
                    } else if (n1.vmid < n2.vmid) {
                        return -1;
                    }
                } else {
                    return n1.name.localeCompare(n2.name);
                }
            }
            // same types but not a guest
            return n1.id > n2.id ? 1 : n1.id < n2.id ? -1 : 0;
        } else if (n1.groupbyid) {
            return -1;
        } else if (n2.groupbyid) {
            return 1;
        }
        return 0; // should not happen
    },

    // private: fast binary search
    findInsertIndex: function (node, child, start, end) {
        let me = this;

        let diff = end - start;
        if (diff <= 0) {
            return start;
        }
        let mid = start + (diff >> 1);

        let res = me.nodeSortFn(child, node.childNodes[mid]);
        if (res <= 0) {
            return me.findInsertIndex(node, child, start, mid);
        } else {
            return me.findInsertIndex(node, child, mid + 1, end);
        }
    },

    setIconCls: function (info) {
        let cls = PVE.Utils.get_object_icon_class(info.type, info);
        if (cls !== '') {
            info.iconCls = cls;
        }
    },

    getToolTip: function (info) {
        let qtips = [];
        if (info.qmpstatus || info.status) {
            qtips.push(Ext.String.format(gettext('Status: {0}'), info.qmpstatus || info.status));
        }
        if (info.lock) {
            qtips.push(Ext.String.format(gettext('Config locked ({0})'), info.lock));
        }
        if (info.hastate !== 'unmanaged') {
            qtips.push(Ext.String.format(gettext('HA State: {0}'), info.hastate));
        }
        if (info.type === 'storage') {
            let usage = info.disk / info.maxdisk;
            if (usage >= 0.0 && usage <= 1.0) {
                qtips.push(Ext.String.format(gettext('Usage: {0}%'), (usage * 100).toFixed(2)));
            }
        }

        if (qtips.length === 0) {
            return undefined;
        }

        let tip = qtips.join(', ');
        info.tip = tip;
        return tip;
    },

    // private
    addChildSorted: function (node, info) {
        let me = this;

        me.setIconCls(info);

        if (info.groupbyid) {
            if (me.viewFilter.groupRenderer) {
                info.text = me.viewFilter.groupRenderer(info);
            } else if (info.type === 'type') {
                let defaults = PVE.tree.ResourceTree.typeDefaults[info.groupbyid];
                if (defaults && defaults.text) {
                    info.text = defaults.text;
                }
            } else {
                info.text = info.groupbyid;
            }
        }
        let child = Ext.create('PVETree', info);

        if (node.childNodes) {
            let pos = me.findInsertIndex(node, child, 0, node.childNodes.length);
            node.insertBefore(child, node.childNodes[pos]);
        } else {
            node.insertBefore(child);
        }

        return child;
    },

    // private
    groupChild: function (node, info, groups, level) {
        let me = this;

        let groupBy = groups[level];
        let v = info[groupBy];

        if (v) {
            let group = node.findChild('groupbyid', v);
            if (!group) {
                let groupinfo;
                if (info.type === groupBy) {
                    groupinfo = info;
                } else {
                    groupinfo = {
                        type: groupBy,
                        id: groupBy + '/' + v,
                    };
                    if (groupBy !== 'type') {
                        groupinfo[groupBy] = v;
                    }
                }
                groupinfo.leaf = false;
                groupinfo.groupbyid = v;
                group = me.addChildSorted(node, groupinfo);
            }
            if (info.type === groupBy) {
                return group;
            }
            if (group) {
                return me.groupChild(group, info, groups, level + 1);
            }
        }

        return me.addChildSorted(node, info);
    },

    saveSortingOptions: function () {
        let me = this;
        let changed = false;
        for (const key of ['sort-field', 'group-templates', 'group-guest-types']) {
            let newValue = PVE.UIOptions.getTreeSortingValue(key);
            if (me[key] !== newValue) {
                me[key] = newValue;
                changed = true;
            }
        }
        return changed;
    },

    initComponent: function () {
        let me = this;
        me.saveSortingOptions();

        let rstore = PVE.data.ResourceStore;
        let sp = Ext.state.Manager.getProvider();

        if (!me.viewFilter) {
            me.viewFilter = {};
        }

        let pdata = {
            dataIndex: {},
            updateCount: 0,
        };

        let store = Ext.create('Ext.data.TreeStore', {
            model: 'PVETree',
            root: {
                expanded: true,
                id: 'root',
                text: gettext('Datacenter'),
                iconCls: 'fa fa-server',
            },
        });

        let stateid = 'rid';

        const changedFields = [
            'disk',
            'maxdisk',
            'vmid',
            'name',
            'type',
            'running',
            'template',
            'status',
            'qmpstatus',
            'hastate',
            'lock',
            'tags',
        ];

        // special case ids from the tag view, since they change the id in the state
        let idMapFn = function (id) {
            if (!id) {
                return undefined;
            }
            if (id.startsWith('qemu') || id.startsWith('lxc')) {
                let [realId, _tag] = id.split('-');
                return realId;
            }
            return id;
        };

        let findNode = function (rootNode, id) {
            if (!id) {
                return undefined;
            }
            let node = rootNode.findChild('id', id, true);
            if (!node) {
                node = rootNode.findChildBy(
                    (r) => idMapFn(r.data.id) === idMapFn(id),
                    undefined,
                    true,
                );
            }
            return node;
        };

        let firstUpdate = true;

        let updateTree = function () {
            store.suspendEvents();

            let rootnode;
            if (firstUpdate) {
                rootnode = Ext.create('PVETree', {
                    expanded: true,
                    id: 'root',
                    text: gettext('Datacenter'),
                    iconCls: 'fa fa-server',
                });
            } else {
                rootnode = me.store.getRootNode();
            }
            // remember selected node (and all parents)
            let sm = me.getSelectionModel();
            let lastsel = sm.getSelection()[0];
            let parents = [];
            let sorting_changed = me.saveSortingOptions();
            for (let node = lastsel; node; node = node.parentNode) {
                parents.push(node);
            }

            let groups = me.viewFilter.groups || [];
            // explicitly check for node/template, as those are not always grouping attributes
            let attrMoveChecks = me.viewFilter.attrMoveChecks ?? {};

            // also check for name for when the tree is sorted by name
            let moveCheckAttrs = groups.concat(['node', 'template', 'name']);
            let filterFn = me.viewFilter.getFilterFn ? me.viewFilter.getFilterFn() : Ext.identityFn;

            let reselect = false; // for disappeared nodes
            let index = pdata.dataIndex;
            // remove vanished or moved items and update changed items in-place
            for (const [key, olditem] of Object.entries(index)) {
                // getById() use find(), which is slow (ExtJS4 DP5)
                let oldid = olditem.data.id;
                let id = idMapFn(olditem.data.id);
                let item = rstore.data.get(id);

                let changed = sorting_changed,
                    moved = sorting_changed;
                if (item) {
                    // test if any grouping attributes changed, catches migrated tree-nodes in server view too
                    for (const attr of moveCheckAttrs) {
                        if (attrMoveChecks[attr]) {
                            if (attrMoveChecks[attr](olditem, item)) {
                                moved = true;
                                break;
                            }
                        } else if (item.data[attr] !== olditem.data[attr]) {
                            moved = true;
                            break;
                        }
                    }

                    // tree item has been updated
                    for (const field of changedFields) {
                        if (item.data[field] !== olditem.data[field]) {
                            changed = true;
                            break;
                        }
                    }
                    // FIXME: also test filterfn()?
                }

                if (changed) {
                    olditem.beginEdit();
                    let info = olditem.data;
                    Ext.apply(info, item.data);
                    if (info.id !== oldid) {
                        info.id = oldid;
                    }
                    me.setIconCls(info);
                    olditem.commit();
                }
                if ((!item || moved) && olditem.isLeaf()) {
                    delete index[key];
                    let parentNode = olditem.parentNode;
                    // a selected item moved (migration) or disappeared (destroyed), so deselect that
                    // node now and try to reselect the moved (or its parent) node later
                    if (lastsel && olditem.data.id === lastsel.data.id) {
                        reselect = true;
                        sm.deselect(olditem);
                    }
                    // store events are suspended, so remove the item manually
                    store.remove(olditem);
                    parentNode.removeChild(olditem, true);
                    if (parentNode.childNodes.length < 1 && parentNode.parentNode) {
                        let grandParent = parentNode.parentNode;
                        grandParent.removeChild(parentNode, true);
                    }
                }
            }

            let items = rstore.getData().items.flatMap(me.viewFilter.itemMap ?? Ext.identityFn);
            items.forEach(function (item) {
                // add new items
                let olditem = index[item.data.id];
                if (olditem) {
                    return;
                }
                if (filterFn && !filterFn(item)) {
                    return;
                }
                let info = Ext.apply({ leaf: true }, item.data);

                let child = me.groupChild(rootnode, info, groups, 0);
                if (child) {
                    index[item.data.id] = child;
                }
            });

            store.resumeEvents();
            store.fireEvent('refresh', store);

            let foundChild = findNode(rootnode, lastsel?.data.id);

            // select parent node if original selected node vanished
            if (lastsel && !foundChild) {
                lastsel = rootnode;
                for (const node of parents) {
                    if (rootnode.findChild('id', node.data.id, true)) {
                        lastsel = node;
                        break;
                    }
                }
                me.selectById(lastsel.data.id);
            } else if (lastsel && reselect) {
                me.selectById(lastsel.data.id);
            }

            if (firstUpdate) {
                me.store.setRoot(rootnode);
                firstUpdate = false;
            }

            // on first tree load set the selection from the stateful provider
            if (!pdata.updateCount) {
                rootnode.expand();
                me.applyState(sp.get(stateid));
            }

            pdata.updateCount++;
        };

        sp.on('statechange', (_sp, key, value) => {
            if (key === stateid) {
                me.applyState(value);
            }
        });

        Ext.apply(me, {
            allowSelection: true,
            store: store,
            viewConfig: {
                animate: false, // note: animate cause problems with applyState
            },
            listeners: {
                itemcontextmenu: PVE.Utils.createCmdMenu,
                destroy: function () {
                    rstore.un('load', updateTree);
                },
                beforecellmousedown: function (tree, td, cellIndex, record, tr, rowIndex, ev) {
                    let sm = me.getSelectionModel();
                    // disable selection when right clicking except if the record is already selected
                    me.allowSelection = ev.button !== 2 || sm.isSelected(record);
                },
                beforeselect: function (tree, record, index, eopts) {
                    let allow = me.allowSelection;
                    me.allowSelection = true;
                    return allow;
                },
                itemdblclick: PVE.Utils.openTreeConsole,
                afterrender: function () {
                    if (me.tip) {
                        return;
                    }
                    let selectors = [
                        '.x-tree-node-text > span:not(.proxmox-tag-dark):not(.proxmox-tag-light)',
                        '.x-tree-icon',
                    ];
                    me.tip = Ext.create('Ext.tip.ToolTip', {
                        target: me.el,
                        delegate: selectors.join(', '),
                        trackMouse: true,
                        renderTo: Ext.getBody(),
                        listeners: {
                            beforeshow: function (tip) {
                                let rec = me.getView().getRecord(tip.triggerElement);
                                let tipText = me.getToolTip(rec.data);
                                if (tipText) {
                                    tip.update(tipText);
                                    return true;
                                }
                                return false;
                            },
                        },
                    });
                },
            },
            setViewFilter: function (view) {
                me.viewFilter = view;
                me.clearTree();
                updateTree();
            },
            clearTree: function () {
                pdata.updateCount = 0;
                let rootnode = me.store.getRootNode();
                rootnode.collapse();
                rootnode.removeAll();
                pdata.dataIndex = {};
                me.getSelectionModel().deselectAll();
            },
            selectExpand: function (node) {
                let sm = me.getSelectionModel();
                if (!sm.isSelected(node)) {
                    sm.select(node);
                    for (let iter = node; iter; iter = iter.parentNode) {
                        if (!iter.isExpanded()) {
                            iter.expand();
                        }
                    }
                    me.getView().focusRow(node);
                }
            },
            selectById: function (nodeid) {
                let rootnode = me.store.getRootNode();
                let node;
                if (nodeid === 'root') {
                    node = rootnode;
                } else {
                    node = findNode(rootnode, nodeid);
                }
                if (node) {
                    me.selectExpand(node);
                }
                return node;
            },
            applyState: function (state) {
                if (state && state.value) {
                    me.selectById(state.value);
                } else {
                    me.getSelectionModel().deselectAll();
                }
            },
        });

        me.callParent();

        me.getSelectionModel().on('select', (_sm, n) => sp.set(stateid, { value: n.data.id }));

        rstore.on('load', updateTree);
        rstore.startUpdate();

        me.mon(Ext.GlobalEvents, 'loadedUiOptions', () => {
            me.store.getRootNode().cascadeBy({
                before: function (node) {
                    if (node.data.groupbyid) {
                        node.beginEdit();
                        let info = node.data;
                        me.setIconCls(info);
                        if (me.viewFilter.groupRenderer) {
                            info.text = me.viewFilter.groupRenderer(info);
                        }
                        node.commit();
                    }
                    return true;
                },
            });
        });
    },
});
