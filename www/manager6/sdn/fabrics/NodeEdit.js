Ext.define('PVE.sdn.Fabric.Node.Edit', {
    extend: 'Proxmox.window.Edit',
    mixins: ['Proxmox.Mixin.CBind'],

    width: 800,
    subject: gettext('Node'),

    isCreate: undefined,

    fabricId: undefined,
    nodeId: undefined,
    protocol: undefined,

    disallowedNodes: [],

    baseUrl: '/cluster/sdn/fabrics/node',

    items: [
        {
            xtype: 'textfield',
            name: 'digest',
            hidden: true,
            allowBlank: true,
        },
        {
            xtype: 'proxmoxtextfield',
            fieldLabel: gettext('IPv4'),
            labelWidth: 120,
            name: 'ip',
            allowBlank: true,
            skipEmptyText: true,
            cbind: {
                deleteEmpty: '{!isCreate}',
            },
        },
    ],

    additionalItems: [],

    addAnotherCallback: undefined,

    initComponent: function () {
        let me = this;

        me.isCreate = me.nodeId === undefined;
        me.autoLoad = !me.isCreate;
        me.method = me.isCreate ? 'POST' : 'PUT';

        if (!me.isCreate) {
            me.url = `${me.baseUrl}/${me.fabricId}/${me.nodeId}`;
        } else {
            me.url = `${me.baseUrl}/${me.fabricId}`;
        }

        me.nodeSelector = me.getNodeSelector();
        me.interfaceSelector = me.getInterfaceSelector();

        me.items = [me.nodeSelector, ...me.items, ...me.additionalItems, me.interfaceSelector];

        me.callParent();

        if (me.isCreate && me.addAnotherCallback) {
            let addAnotherBtn = Ext.create('Ext.Button', {
                text: gettext('Create another'),
                disabled: !me.isCreate,
                handler: function () {
                    me.apiCallDone = (success, _response, _options) => {
                        if (success) {
                            me.addAnotherCallback();
                        }
                    };

                    me.submit();
                },
            });

            let form = me.formPanel.getForm();

            let set_button_status = function () {
                let valid = form.isValid();
                let dirty = form.isDirty();
                addAnotherBtn.setDisabled(!valid || !(dirty || me.isCreate));
            };

            form.on('dirtychange', set_button_status);
            form.on('validitychange', set_button_status);

            me.getDockedItems()[0].add(addAnotherBtn);
        }
    },

    loadNode: async function () {
        let me = this;

        if (me.isCreate) {
            return {};
        }

        let req = await Proxmox.Async.api2({
            url: `/cluster/sdn/fabrics/node/${me.fabricId}/${me.nodeId}`,
            method: 'GET',
        });

        return req.result.data;
    },

    loadNodeInterfaces: async function () {
        let me = this;

        let req = await Proxmox.Async.api2({
            url: `/api2/extjs/nodes/${me.nodeId}/network`,
            method: 'GET',
        });

        return req.result.data.map((iface) => ({
            name: iface.iface,
            type: iface.type,
            ip: iface.cidr,
            ipv6: iface.cidr6,
        }));
    },

    load: function () {
        let me = this;

        me.setLoading('fetching node information');

        Promise.all([me.loadNode(me.fabricId, me.nodeId), me.loadNodeInterfaces(me.nodeId)])
            .catch(Proxmox.Utils.alertResponseFailure)
            .then(([node, nodeInterfaces]) => {
                me.interfaceSelector.setNodeInterfaces(nodeInterfaces);
                me.setValues(node);
            })
            .finally(() => {
                me.setLoading(false);
            });
    },

    getNodeSelector: function () {
        let me = this;

        return Ext.create('PVE.form.NodeSelector', {
            xtype: 'pveNodeSelector',
            reference: 'nodeselector',
            fieldLabel: gettext('Node'),
            labelWidth: 120,
            name: 'node_id',
            allowBlank: false,
            disabled: !me.isCreate,
            disallowedNodes: me.disallowedNodes,
            onlineValidator: me.isCreate,
            autoSelect: me.isCreate,
            listeners: {
                change: function (f, value) {
                    if (me.isCreate) {
                        me.nodeId = value;
                        me.load();
                    }
                },
            },
            listConfig: {
                columns: [
                    {
                        header: gettext('Node'),
                        dataIndex: 'node',
                        sortable: true,
                        hideable: false,
                        flex: 1,
                    },
                ],
            },
            store: {
                fields: ['node'],
                proxy: {
                    type: 'proxmox',
                    url: '/api2/json/nodes',
                },
                sorters: [
                    {
                        property: 'node',
                        direction: 'ASC',
                    },
                ],
                listeners: {
                    load: function (store) {
                        if (store.count() === 0) {
                            Ext.Msg.alert(
                                gettext('Add Node'),
                                gettext('All available nodes are already part of the fabric'),
                                () => me.destroy(),
                            );
                        }
                    },
                },
            },
        });
    },

    getInterfacePanel: function (protocol) {
        const INTERFACE_PANELS = {
            openfabric: 'PVE.sdn.Fabric.OpenFabric.InterfacePanel',
            ospf: 'PVE.sdn.Fabric.Ospf.InterfacePanel',
        };

        return INTERFACE_PANELS[protocol];
    },

    getInterfaceSelector: function () {
        let me = this;

        return Ext.create(me.getInterfacePanel(me.protocol), {
            name: 'interfaces',
        });
    },
});
