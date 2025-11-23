Ext.define('PVE.sdn.Fabric.TreeModel', {
    extend: 'Ext.data.TreeModel',
    idProperty: 'tree_id',
});

Ext.define('PVE.sdn.Fabric.View', {
    extend: 'Ext.tree.Panel',

    xtype: 'pveSDNFabricView',

    onlineHelp: 'pvesdn_config_fabrics',

    columns: [
        {
            xtype: 'treecolumn',
            text: gettext('Name'),
            dataIndex: 'node_id',
            width: 200,
            renderer: function (value, metaData, rec) {
                if (rec.data.type === 'fabric') {
                    return PVE.Utils.render_sdn_pending(rec, rec.data.id, 'id');
                }

                return PVE.Utils.render_sdn_pending(rec, value, 'node_id');
            },
        },
        {
            text: gettext('Protocol'),
            dataIndex: 'protocol',
            width: 100,
            renderer: function (value, metaData, rec) {
                if (rec.data.type === 'fabric') {
                    const PROTOCOL_DISPLAY_NAMES = {
                        openfabric: 'OpenFabric',
                        ospf: 'OSPF',
                    };
                    const displayValue = PROTOCOL_DISPLAY_NAMES[value];
                    if (rec.data.state === undefined || rec.data.state === null) {
                        return Ext.htmlEncode(displayValue);
                    }
                    if (rec.data.state === 'deleted') {
                        if (value === undefined) {
                            return ' ';
                        } else {
                            let encoded = Ext.htmlEncode(displayValue);
                            return `<span style="text-decoration: line-through;">${encoded}</span>`;
                        }
                    }
                    return Ext.htmlEncode(displayValue);
                }

                return '';
            },
        },
        {
            text: gettext('IPv4'),
            dataIndex: 'ip',
            width: 150,
            renderer: function (value, metaData, rec) {
                if (rec.data.type === 'fabric') {
                    return PVE.Utils.render_sdn_pending(rec, rec.data.ip_prefix, 'ip_prefix');
                }

                return PVE.Utils.render_sdn_pending(rec, value, 'ip');
            },
        },
        {
            text: gettext('IPv6'),
            dataIndex: 'ip6',
            width: 150,
            renderer: function (value, metaData, rec) {
                if (rec.data.type === 'fabric') {
                    return PVE.Utils.render_sdn_pending(rec, rec.data.ip6_prefix, 'ip6_prefix');
                }

                return PVE.Utils.render_sdn_pending(rec, value, 'ip6');
            },
        },
        {
            header: gettext('Interfaces'),
            width: 200,
            dataIndex: 'interface',
            renderer: function (value, metaData, rec) {
                const interfaces = rec.data.pending?.interfaces || rec.data.interfaces || [];

                let names = interfaces.map((iface) => {
                    const properties = Proxmox.Utils.parsePropertyString(iface);
                    return properties.name;
                });

                names.sort();
                const displayValue = Ext.htmlEncode(names.join(', '));
                if (rec.data.state === 'deleted') {
                    return `<span style="text-decoration: line-through;">${displayValue}</span>`;
                }
                return displayValue;
            },
        },
        {
            text: gettext('Action'),
            xtype: 'actioncolumn',
            dataIndex: 'text',
            width: 100,
            items: [
                {
                    handler: 'addActionTreeColumn',
                    getTip: (_v, _m, _rec) => gettext('Add Node'),
                    getClass: (_v, _m, { data }) => {
                        if (data.type === 'fabric') {
                            return 'fa fa-plus-circle';
                        }

                        return 'pmx-hidden';
                    },
                    isActionDisabled: (_v, _r, _c, _i, { data }) => data.type !== 'fabric',
                },
                {
                    tooltip: gettext('Edit'),
                    handler: 'editAction',
                    getClass: (_v, _m, { data }) => {
                        // the fabric type (openfabric, ospf, etc.) cannot be edited
                        if (data.type && data.state !== 'deleted') {
                            return 'fa fa-pencil fa-fw';
                        }

                        return 'pmx-hidden';
                    },
                    isActionDisabled: (_v, _r, _c, _i, { data }) => !data.type,
                },
                {
                    tooltip: gettext('Delete'),
                    handler: 'deleteAction',
                    getClass: (_v, _m, { data }) => {
                        // the fabric type (openfabric, ospf, etc.) cannot be deleted
                        if (data.type && data.state !== 'deleted') {
                            return 'fa critical fa-trash-o';
                        }

                        return 'pmx-hidden';
                    },
                    isActionDisabled: (_v, _r, _c, _i, { data }) => !data.type,
                },
            ],
        },
        {
            header: gettext('State'),
            width: 100,
            dataIndex: 'state',
            renderer: function (value, metaData, rec) {
                return PVE.Utils.render_sdn_pending_state(rec, value);
            },
        },
    ],

    store: {
        sorters: ['tree_id'],
        model: 'PVE.sdn.Fabric.TreeModel',
    },

    layout: 'fit',
    rootVisible: false,
    animate: false,

    initComponent: function () {
        let me = this;

        let addNodeButton = new Proxmox.button.Button({
            text: gettext('Add Node'),
            handler: 'addActionTbar',
            disabled: true,
        });

        let setAddNodeButtonStatus = function () {
            let selection = me.view.getSelection();

            if (selection.length === 0) {
                return;
            }

            let enabled = selection[0].data.type === 'fabric';
            addNodeButton.setDisabled(!enabled);
        };

        Ext.apply(me, {
            tbar: [
                {
                    text: gettext('Add Fabric'),
                    menu: [
                        {
                            text: 'OpenFabric',
                            handler: 'addOpenfabric',
                        },
                        {
                            text: 'OSPF',
                            handler: 'addOspf',
                        },
                    ],
                },
                addNodeButton,
                {
                    xtype: 'proxmoxButton',
                    text: gettext('Reload'),
                    handler: function () {
                        const view = this.up('pveSDNFabricView');
                        view.getController().reload();
                    },
                },
            ],
            listeners: {
                selectionchange: setAddNodeButtonStatus,
            },
        });

        me.callParent();
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        reload: function (successCallback) {
            let me = this;

            Proxmox.Utils.API2Request({
                url: `/cluster/sdn/fabrics/all?pending=1`,
                method: 'GET',
                success: function (response, opts) {
                    let fabrics = {};

                    for (const fabric of response.result.data.fabrics) {
                        let mergedFabric = {
                            expanded: true,
                            type: 'fabric',
                            iconCls: 'fa fa-road x-fa-treepanel',
                            children: [],
                            ...fabric,
                            ...fabric.pending,
                        };

                        mergedFabric.tree_id = mergedFabric.id;

                        fabrics[mergedFabric.id] = mergedFabric;
                    }

                    for (const node of response.result.data.nodes) {
                        let mergedNode = {
                            type: 'node',
                            iconCls: 'fa fa-desktop x-fa-treepanel',
                            leaf: true,
                            ...node,
                            ...node.pending,
                        };

                        mergedNode.tree_id = `${mergedNode.fabric_id}_${mergedNode.node_id}`;

                        fabrics[mergedNode.fabric_id].children.push(mergedNode);
                    }

                    me.getView().setRootNode({
                        name: '__root',
                        expanded: true,
                        children: Object.values(fabrics),
                    });

                    if (successCallback) {
                        successCallback();
                    }
                },
            });
        },

        getFabricEditPanel: function (protocol) {
            const FABRIC_PANELS = {
                openfabric: 'PVE.sdn.Fabric.OpenFabric.Fabric.Edit',
                ospf: 'PVE.sdn.Fabric.Ospf.Fabric.Edit',
            };

            return FABRIC_PANELS[protocol];
        },

        getNodeEditPanel: function (protocol) {
            const NODE_PANELS = {
                openfabric: 'PVE.sdn.Fabric.OpenFabric.Node.Edit',
                ospf: 'PVE.sdn.Fabric.Ospf.Node.Edit',
            };

            return NODE_PANELS[protocol];
        },

        addOpenfabric: function () {
            let me = this;
            me.openFabricAddWindow('openfabric');
        },

        addOspf: function () {
            let me = this;
            me.openFabricAddWindow('ospf');
        },

        openFabricAddWindow: function (protocol) {
            let me = this;

            let component = me.getFabricEditPanel(protocol);

            let window = Ext.create(component, {
                autoShow: true,
                autoLoad: false,
                isCreate: true,
            });

            window.on('destroy', () => me.reload());
        },

        addActionTreeColumn: function (_grid, _rI, _cI, _item, _e, rec) {
            this.openNodeAddWindow(rec.data);
        },

        addActionTbar: function () {
            let me = this;

            let selection = me.view.getSelection();

            if (selection.length === 0) {
                return;
            }

            if (selection[0].data.type === 'fabric') {
                me.openNodeAddWindow(selection[0].data);
            }
        },

        openNodeAddWindow: function (fabric) {
            let me = this;

            let component = me.getNodeEditPanel(fabric.protocol);

            let disallowedNodes = fabric.children
                .filter((node) => !node.state || node.state !== 'deleted')
                .map((node) => node.node_id);

            Ext.create(component, {
                autoShow: true,
                fabricId: fabric.id,
                protocol: fabric.protocol,
                disallowedNodes,
                addAnotherCallback: () => {
                    let successCallback = () => {
                        let new_fabric = me
                            .getView()
                            .getStore()
                            .findRecord('tree_id', fabric.tree_id);

                        me.openNodeAddWindow(new_fabric.data);
                    };

                    me.reload(successCallback);
                },
                apiCallDone: (success, _response, _options) => {
                    if (success) {
                        me.reload();
                    }
                },
            });
        },

        openFabricEditWindow: function (fabric) {
            let me = this;

            let component = me.getFabricEditPanel(fabric.protocol);

            let window = Ext.create(component, {
                autoShow: true,
                fabricId: fabric.id,
            });

            window.on('destroy', () => me.reload());
        },

        openNodeEditWindow: function (node) {
            let me = this;

            let component = me.getNodeEditPanel(node.protocol);

            let window = Ext.create(component, {
                autoShow: true,
                fabricId: node.fabric_id,
                nodeId: node.node_id,
                protocol: node.protocol,
            });

            window.on('destroy', () => me.reload());
        },

        editAction: function (_grid, _rI, _cI, _item, _e, rec) {
            let me = this;

            if (rec.data.type === 'fabric') {
                me.openFabricEditWindow(rec.data);
            } else if (rec.data.type === 'node') {
                me.openNodeEditWindow(rec.data);
            } else {
                console.warn(`unknown type ${rec.data.type}`);
            }
        },

        handleDeleteAction: function (url, message) {
            let me = this;
            let view = me.getView();

            Ext.Msg.show({
                title: gettext('Confirm'),
                icon: Ext.Msg.WARNING,
                message: Ext.htmlEncode(message),
                buttons: Ext.Msg.YESNO,
                defaultFocus: 'no',
                callback: function (btn) {
                    if (btn !== 'yes') {
                        return;
                    }

                    Proxmox.Utils.API2Request({
                        url,
                        method: 'DELETE',
                        waitMsgTarget: view,
                        failure: function (response, opts) {
                            Ext.Msg.alert(Proxmox.Utils.errorText, response.htmlStatus);
                        },
                        callback: () => me.reload(),
                    });
                },
            });
        },

        deleteAction: function (table, rI, cI, item, e, rec) {
            let me = this;

            if (rec.data.type === 'fabric') {
                let message = Ext.String.format(
                    gettext('Are you sure you want to remove the fabric "{0}"?'),
                    rec.data.id,
                );

                let url = `/cluster/sdn/fabrics/fabric/${rec.data.id}`;

                me.handleDeleteAction(url, message);
            } else if (rec.data.type === 'node') {
                let message = Ext.String.format(
                    gettext(
                        'Are you sure you want to remove the node "{0}" from the fabric "{1}"?',
                    ),
                    rec.data.node_id,
                    rec.data.fabric_id,
                );

                let url = `/cluster/sdn/fabrics/node/${rec.data.fabric_id}/${rec.data.node_id}`;

                me.handleDeleteAction(url, message);
            } else {
                console.warn(`unknown type: ${rec.data.type}`);
            }
        },

        init: function (view) {
            let me = this;
            me.reload();
        },
    },
});
