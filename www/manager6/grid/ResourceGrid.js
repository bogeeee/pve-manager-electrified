Ext.define('PVE.grid.ResourceGrid', {
    extend: 'Ext.grid.GridPanel',
    alias: ['widget.pveResourceGrid'],

    border: false,
    defaultSorter: {
        property: 'type',
        direction: 'ASC',
    },
    userCls: 'proxmox-tags-full',
    initComponent: function () {
        let me = this;

        let rstore = PVE.data.ResourceStore;

        let store = Ext.create('Ext.data.Store', {
            model: 'PVEResources',
            sorters: me.defaultSorter,
            proxy: {
                type: 'memory',
            },
        });

        let textfilter = '';
        let textfilterMatch = function (item) {
            for (const field of ['name', 'storage', 'node', 'type', 'text']) {
                let v = item.data[field];
                if (v && v.toLowerCase().indexOf(textfilter) >= 0) {
                    return true;
                }
            }
            return false;
        };

        let updateGrid = function () {
            var filterfn = me.viewFilter ? me.viewFilter.filterfn : null;

            store.suspendEvents();

            let nodeidx = {};
            let gather_child_nodes;
            gather_child_nodes = function (node) {
                if (!node || !node.childNodes) {
                    return;
                }
                for (let child of node.childNodes) {
                    let orgNode = rstore.data.get(child.data.realId ?? child.data.id);
                    if (orgNode) {
                        if (
                            (!filterfn || filterfn(child)) &&
                            (!textfilter || textfilterMatch(child))
                        ) {
                            nodeidx[child.data.id] = orgNode;
                        }
                    }
                    gather_child_nodes(child);
                }
            };
            gather_child_nodes(me.pveSelNode);

            // remove vanished items
            let rmlist = [];
            store.each((olditem) => {
                if (!nodeidx[olditem.data.id]) {
                    rmlist.push(olditem);
                }
            });
            if (rmlist.length) {
                store.remove(rmlist);
            }

            // add new items
            let addlist = [];
            for (const [_key, item] of Object.entries(nodeidx)) {
                // getById() use find(), which is slow (ExtJS4 DP5)
                let olditem = store.data.get(item.data.id);
                if (!olditem) {
                    addlist.push(item);
                    continue;
                }
                let changes = false;
                for (let field of PVE.data.ResourceStore.fieldNames) {
                    if (field !== 'id' && item.data[field] !== olditem.data[field]) {
                        changes = true;
                        olditem.beginEdit();
                        olditem.set(field, item.data[field]);
                    }
                }
                if (changes) {
                    olditem.endEdit(true);
                    olditem.commit(true);
                }
            }
            if (addlist.length) {
                store.add(addlist);
            }
            store.sort();
            store.resumeEvents();
            store.fireEvent('refresh', store);
        };

        Ext.apply(me, {
            store: store,
            stateful: true,
            stateId: 'grid-resource',
            tbar: [
                '->',
                gettext('Search') + ':',
                ' ',
                {
                    xtype: 'textfield',
                    width: 200,
                    value: textfilter,
                    enableKeyEvents: true,
                    listeners: {
                        buffer: 500,
                        keyup: function (field, e) {
                            textfilter = field.getValue().toLowerCase();
                            updateGrid();
                        },
                    },
                },
            ],
            viewConfig: {
                stripeRows: true,
            },
            listeners: {
                itemcontextmenu: PVE.Utils.createCmdMenu,
                itemdblclick: function (v, record) {
                    var ws = me.up('pveStdWorkspace');
                    ws.selectById(record.data.id);
                },
                afterrender: function () {
                    updateGrid();
                },
            },
            columns: rstore.defaultColumns(),
        });
        me.callParent();
        me.mon(rstore, 'load', () => updateGrid());
    },
});
