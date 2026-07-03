Ext.define('PVE.sdn.Fabric.Node.Edit', {
    extend: 'Proxmox.window.Edit',
    mixins: ['Proxmox.Mixin.CBind'],

    width: 800,
    subject: gettext('Node'),

    isCreate: undefined,

    fabricId: undefined,
    nodeId: undefined,
    protocol: undefined,

    hasIpv4Support: true,
    hasIpv6Support: true,

    fabricIpPrefix: undefined,
    fabricIp6Prefix: undefined,

    disallowedNodes: [],

    baseUrl: '/cluster/sdn/fabrics/node',

    items: [
        {
            xtype: 'textfield',
            name: 'digest',
            hidden: true,
            allowBlank: true,
        },
    ],

    additionalItems: [],

    addAnotherCallback: undefined,
    includeWireguardInterfaces: false,

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

        if (me.hasIpv4Support && me.fabricIpPrefix) {
            me.items.push({
                xtype: 'proxmoxtextfield',
                fieldLabel: gettext('IPv4'),
                labelWidth: 120,
                name: 'ip',
                vtype: 'IPAddress',
                allowBlank: true,
                skipEmptyText: true,
                cbind: {
                    deleteEmpty: '{!isCreate}',
                },
            });
        }

        if (me.hasIpv6Support && me.fabricIp6Prefix) {
            me.items.push({
                xtype: 'proxmoxtextfield',
                fieldLabel: gettext('IPv6'),
                labelWidth: 120,
                name: 'ip6',
                vtype: 'IP6Address',
                allowBlank: true,
                skipEmptyText: true,
                cbind: {
                    deleteEmpty: '{!isCreate}',
                },
            });
        }

        me.nodeSelector = me.getNodeSelector();
        me.interfaceSelector = me.getInterfaceSelector();

        me.items = [me.nodeSelector, ...me.items, ...me.additionalItems, me.interfaceSelector];

        me.callParent();

        if (me.isCreate && me.addAnotherCallback) {
            let addAnotherBtn = Ext.create('Ext.Button', {
                text: gettext('Create Another'),
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

        let requests = [
            Proxmox.Async.api2({
                url: `/api2/extjs/nodes/${me.nodeId}/network`,
                method: 'GET',
            }),
        ];

        if (me.includeWireguardInterfaces) {
            requests.push(
                Proxmox.Async.api2({
                    url: `/api2/extjs/cluster/sdn/fabrics/node/`,
                    method: 'GET',
                }),
            );
        }

        let result = await Promise.all(requests);

        let interfaces = result[0].result.data.map((iface) => ({
            name: iface.iface,
            type: iface.type,
            ip: iface.cidr,
            ip6: iface.cidr6,
        }));

        if (me.includeWireguardInterfaces) {
            let wireguardNodes = result[1].result.data.filter((node) => {
                return (
                    node.node_id === me.nodeId && node.protocol === 'wireguard' && node.interfaces
                );
            });

            for (const node of wireguardNodes) {
                for (const ifacePropertyString of node.interfaces) {
                    let iface = PVE.Parser.parsePropertyString(ifacePropertyString);

                    interfaces.push({
                        name: iface.name,
                        type: 'wireguard',
                    });
                }
            }
        }

        return interfaces;
    },

    load: function () {
        let me = this;

        me.setLoading(gettext('Fetching Node Information'));

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

    getNodeSelectorConfig: function () {
        let me = this;

        return {
            xtype: 'pveNodeSelector',
            reference: 'nodeSelector',
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
        };
    },

    getNodeSelector: function () {
        let me = this;
        return Ext.create('PVE.form.NodeSelector', me.getNodeSelectorConfig());
    },

    getInterfacePanel: function (protocol) {
        const INTERFACE_PANELS = {
            openfabric: 'PVE.sdn.Fabric.OpenFabric.InterfacePanel',
            ospf: 'PVE.sdn.Fabric.Ospf.InterfacePanel',
            wireguard: 'PVE.sdn.Fabric.WireGuard.InterfacePanel',
            bgp: 'PVE.sdn.Fabric.Bgp.InterfacePanel',
        };

        return INTERFACE_PANELS[protocol];
    },

    getInterfaceSelector: function () {
        let me = this;

        let componentName = me.getInterfacePanel(me.protocol);

        return Ext.create(componentName, {
            name: 'interfaces',
            reference: 'interfaceSelector',
        });
    },
});
