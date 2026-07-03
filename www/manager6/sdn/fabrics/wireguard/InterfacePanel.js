Ext.define('Pve.sdn.Fabric.WireGuard.Interface', {
    extend: 'Ext.data.Model',
    idProperty: 'name',
    fields: ['name', 'ip', 'ip6', 'listen_port', 'peers'],
});

Ext.define('Pve.sdn.Fabric.WireGuard.InterfacePeer', {
    extend: 'Ext.data.Model',
    fields: ['node', 'node_iface', 'type', 'endpoint', 'skip_route_generation'],
});

Ext.define('PVE.sdn.Fabric.WireGuard.PeerSelectionPanel', {
    extend: 'Ext.grid.Panel',
    alias: 'widget.pveSDNWireGuardPeerSelector',

    emptyText: gettext('No peers available'),

    selModel: {
        type: 'checkboxmodel',
        mode: 'SIMPLE',
    },

    store: {
        model: 'Pve.sdn.Fabric.WireGuard.InterfacePeer',
    },

    config: {
        currentNode: null,
        availablePeers: [],
        selectedPeers: [],
    },

    publishes: ['selectedPeers'],

    columns: [
        {
            header: gettext('Name'),
            dataIndex: 'node',
            flex: 1,
        },
        {
            header: gettext('Interface'),
            dataIndex: 'node_iface',
            flex: 1,
        },
        {
            header: gettext('Type'),
            dataIndex: 'type',
            flex: 1,
        },
        {
            header: gettext('Endpoint'),
            dataIndex: 'endpoint',
            flex: 1,
            renderer: function (value, _metaData, record) {
                let me = this;

                if (!value) {
                    let availablePeer = me.getAvailablePeers().find((availablePeer) => {
                        return (
                            availablePeer.node === record.data.node &&
                            availablePeer.node_iface === record.data.node_iface
                        );
                    });
                    value = availablePeer?.endpoint;
                }

                return value ? Ext.String.htmlEncode(value) : '';
            },
        },
        {
            header: gettext('Skip Route Generation'),
            flex: 1,
            xtype: 'widgetcolumn',
            widget: {
                xtype: 'proxmoxcheckbox',
                bind: {
                    value: '{record.skip_route_generation}',
                },
            },
        },
    ],

    updateCurrentNode: function () {
        let me = this;
        me.updatePeerList();
    },

    updateAvailablePeers: function () {
        let me = this;
        me.updatePeerList();
    },

    updateSelectedPeers: function () {
        let me = this;
        me.updatePeerList();
    },

    updatePeerList: function () {
        let me = this;

        if (!me.isConfiguring) {
            let currentNode = me.getCurrentNode();
            if (!currentNode) {
                return;
            }

            let store = me.getStore();

            let selectionModel = me.getSelectionModel();
            selectionModel.suspendEvents();

            selectionModel.select([]);
            store.removeAll();

            let availablePeers = me.getAvailablePeers();
            let selectedPeers = me.getSelectedPeers();

            for (const availablePeer of availablePeers) {
                if (availablePeer.node === currentNode.node_id) {
                    continue;
                }

                let selectedPeer = selectedPeers?.find((selectedPeer) => {
                    return (
                        selectedPeer.data.node === availablePeer.node &&
                        selectedPeer.data.node_iface === availablePeer.node_iface
                    );
                });

                let model = store.add(selectedPeer ?? structuredClone(availablePeer));

                if (selectedPeer) {
                    selectionModel.select(model, true);
                }
            }

            selectionModel.resumeEvents();
            me.publishState('selectedPeers', selectionModel.getSelection());
        }
    },

    initComponent: function () {
        let me = this;

        me.callParent();

        me.getStore().on({
            datachanged: () => me.fireEvent('datachanged'),
            update: () => me.fireEvent('update'),
        });

        me.on('selectionchange', function (_selectionModel, selected) {
            me.publishState('selectedPeers', selected);
        });
    },
});

Ext.define('PVE.sdn.Fabric.WireGuard.InterfacePanel', {
    extend: 'Ext.panel.Panel',
    mixins: ['Ext.form.field.Field'],

    xtype: 'pveSDNFabricWireGuardInterfacePanel',

    minHeight: 200,

    layout: {
        type: 'hbox',
        align: 'stretch',
    },

    config: {
        deleteEmpty: true,
    },

    viewModel: {
        data: {
            availablePeers: [],
            currentNode: null,
        },
        stores: {
            interfaces: {
                model: 'Pve.sdn.Fabric.WireGuard.Interface',
            },
        },
        formulas: {
            selectedInterface: {
                bind: '{interfaceGrid.selection}',
                get: function (selection) {
                    if (Array.isArray(selection)) {
                        return selection[0];
                    }

                    return selection;
                },
            },
        },
    },

    items: [
        {
            xtype: 'panel',
            layout: {
                type: 'vbox',
                align: 'stretch',
            },
            border: false,
            width: 200,
            margin: '0 10 0 0',
            items: [
                {
                    xtype: 'grid',
                    reference: 'interfaceGrid',
                    flex: 1,
                    margin: '0 0 10 0',
                    hideHeaders: true,
                    viewConfig: {
                        emptyText: gettext('No interfaces configured'),
                        deferEmptyText: false,
                    },
                    columns: [
                        {
                            text: gettext('Name'),
                            dataIndex: 'name',
                            flex: 1,
                        },
                        {
                            xtype: 'actioncolumn',
                            width: 20,
                            items: [
                                {
                                    iconCls: 'fa critical fa-trash-o',
                                    tooltip: gettext('Remove'),
                                    handler: function (
                                        table,
                                        _rowIndex,
                                        _colIndex,
                                        _item,
                                        _e,
                                        rec,
                                    ) {
                                        let removeRecord = () => {
                                            let grid = table.up('grid[reference=interfaceGrid]');

                                            let updateSelection = grid.getSelection().includes(rec);

                                            grid.getStore().remove(rec);

                                            if (updateSelection) {
                                                grid.setSelection(grid.getStore().first());
                                            }
                                        };

                                        if (rec.data.isCreate) {
                                            removeRecord();
                                            return;
                                        }

                                        Ext.Msg.show({
                                            title: gettext('Confirm'),
                                            icon: Ext.Msg.WARNING,
                                            message: Ext.String.format(
                                                gettext(
                                                    "Remove interface '{0}'? Any generated private key will be discarded on save.",
                                                ),
                                                `${rec.data.name}`,
                                            ),
                                            buttons: Ext.Msg.YESNO,
                                            defaultFocus: 'no',
                                            callback: function (btn) {
                                                if (btn !== 'yes') {
                                                    return;
                                                }
                                                removeRecord();
                                            },
                                        });
                                    },
                                },
                            ],
                        },
                    ],
                    bind: {
                        store: '{interfaces}',
                    },
                },
                {
                    xtype: 'button',
                    text: gettext('Add Interface'),
                    handler: 'addInterface',
                },
            ],
        },
        {
            xtype: 'panel',
            border: false,
            flex: 1,
            width: 300,
            hidden: true,
            layout: {
                type: 'vbox',
                pack: 'center',
                align: 'center',
            },
            bind: {
                hidden: '{selectedInterface}',
            },
            items: [
                {
                    xtype: 'component',
                    html: gettext('Select an interface to configure, or add a new one.'),
                    style: {
                        'font-style': 'italic',
                        'text-align': 'center',
                    },
                },
            ],
        },
        {
            xtype: 'form',
            border: false,
            flex: 1,
            width: 300,
            padding: 4,
            hidden: true,
            items: [
                {
                    xtype: 'proxmoxtextfield',
                    fieldLabel: gettext('Name'),
                    isFormField: false,
                    emptyText: 'wg0',
                    bind: {
                        value: '{selectedInterface.name}',
                        disabled: '{!selectedInterface.isCreate}',
                    },
                },
                {
                    xtype: 'displayfield',
                    fieldLabel: gettext('Public Key'),
                    isFormField: false,
                    // displayfield ignores emptyText; render the value escaped
                    // so a hypothetical untrusted future value cannot inject
                    // markup, and fall back to an italicised hint when empty.
                    renderer: (v) =>
                        v ? Ext.String.htmlEncode(v) : `<em>${gettext('generated on save')}</em>`,
                    bind: {
                        value: '{selectedInterface.public_key}',
                    },
                },
                {
                    xtype: 'proxmoxintegerfield',
                    fieldLabel: gettext('Listen Port'),
                    bind: '{selectedInterface.listen_port}',
                    minValue: 1,
                    maxValue: 65535,
                    isFormField: false,
                },
                {
                    fieldLabel: gettext('IPv4 Address'),
                    bind: '{selectedInterface.ip}',
                    xtype: 'proxmoxtextfield',
                    emptyText: '198.51.100.1/24',
                    isFormField: false,
                },
                {
                    fieldLabel: gettext('IPv6 Address'),
                    bind: '{selectedInterface.ip6}',
                    xtype: 'proxmoxtextfield',
                    emptyText: '2001:db8::1/64',
                    isFormField: false,
                },
                {
                    xtype: 'pveSDNWireGuardPeerSelector',
                    reference: 'peerSelector',
                    bind: {
                        currentNode: '{currentNode}',
                        availablePeers: '{availablePeers}',
                        selectedPeers: '{selectedInterface.peers}',
                    },
                },
            ],
            bind: {
                hidden: '{!selectedInterface}',
            },
        },
    ],

    previousDirty: false,

    controller: {
        xclass: 'Ext.app.ViewController',

        addInterface: function () {
            let me = this;

            let interfacesStore = me.getView().getViewModel().getStore('interfaces');

            let idx = 0;
            let name = `wg${idx}`;

            while (interfacesStore.getById(name)) {
                idx++;
                name = `wg${idx}`;
            }

            let usedPorts = new Set(interfacesStore.getData().items.map((r) => r.data.listen_port));
            let listenPort = 51820;
            while (usedPorts.has(listenPort)) {
                listenPort++;
            }

            let newInterface = interfacesStore.add({
                name,
                peers: [],
                listen_port: listenPort,
                isCreate: true,
            });

            let interfaceGrid = me.lookupReference('interfaceGrid');
            interfaceGrid.setSelection(newInterface);
        },
    },

    selectFirstInterface: function () {
        let me = this;

        let firstInterface = me.getViewModel().getStore('interfaces').first();
        if (firstInterface) {
            me.lookupReference('interfaceGrid').setSelection([firstInterface]);
        }
    },

    setAvailablePeers: function (availablePeers) {
        let me = this;
        me.getViewModel().set('availablePeers', availablePeers);
    },

    setNode: async function (node) {
        let me = this;

        let ifaces = {};

        for (const iface of node.interfaces) {
            let treeIface = {
                id: iface.name,
                peers: [],
                isCreate: false,
                ...PVE.Parser.parsePropertyString(iface),
            };

            ifaces[treeIface.name] = treeIface;
        }

        let droppedPeers = [];
        for (let peer of node.peers) {
            peer = PVE.Parser.parsePropertyString(peer);
            if (!ifaces[peer.iface]) {
                droppedPeers.push(peer);
                continue;
            }
            ifaces[peer.iface].peers.push(
                Ext.create('Pve.sdn.Fabric.WireGuard.InterfacePeer', peer),
            );
        }
        if (droppedPeers.length > 0) {
            console.warn(
                `WireGuard: dropping ${droppedPeers.length} peer(s) referencing missing interfaces:`,
                droppedPeers,
            );
            Ext.Msg.alert(
                gettext('WireGuard'),
                Ext.String.format(
                    gettext(
                        '{0} peer entry(ies) reference an interface that no longer exists on this node and were dropped from the form. Saving will not include them.',
                    ),
                    droppedPeers.length,
                ),
            );
        }

        me.getViewModel().set('currentNode', node);

        me.isLoading = true;
        try {
            me.getViewModel().getStore('interfaces').setData(Object.values(ifaces));
        } finally {
            me.isLoading = false;
        }
        me.previousDirty = false;

        me.selectFirstInterface();
    },

    isDirty: function () {
        let me = this;

        let interfaceStore = me.getViewModel().getStore('interfaces');
        let interfaces = interfaceStore.getData().items;

        if (interfaces === undefined) {
            return false;
        }

        return (
            interfaceStore.getNewRecords().length > 0 ||
            interfaceStore.getRemovedRecords().length > 0 ||
            interfaces.some(
                (iface) => iface.isDirty() || iface.data.peers.some((peer) => peer.isDirty()),
            )
        );
    },

    initComponent: function () {
        let me = this;

        me.callParent();

        let store = me.getViewModel().getStore('interfaces');

        let refreshDirty = () => {
            if (me.isLoading) {
                return;
            }
            let dirtyStatus = me.isDirty();
            if (dirtyStatus !== me.previousDirty) {
                me.previousDirty = dirtyStatus;
                me.fireEvent('dirtychange');
            }
        };

        me.lookupReference('peerSelector').on({
            datachanged: refreshDirty,
            update: refreshDirty,
        });
        store.on({
            add: refreshDirty,
            remove: refreshDirty,
            update: refreshDirty,
        });
    },

    getSubmitData: function () {
        let me = this;

        if (me.isDisabled()) {
            return null;
        }

        let peers = [];
        let interfaces = [];

        for (let record of me.getViewModel().getStore('interfaces').getData().items) {
            let data = {};

            for (const [key, value] of Object.entries(record.data)) {
                if (value === '' || value === undefined || value === null) {
                    continue;
                }

                if (['peers', 'isCreate'].includes(key)) {
                    // peers are handled later separately, since they're two
                    // fields when talking to the API, but in the UI, they're a
                    // field in the interface model itself
                    //
                    // Other fields are ExtJS specific, so don't send them to
                    // the backend.
                    continue;
                }

                data[key] = value;
            }

            for (const peer of record.data.peers) {
                let peerData = {
                    iface: record.data.name,
                };

                for (let [key, value] of Object.entries(peer.data)) {
                    if (value === '' || value === undefined || value === null) {
                        continue;
                    }

                    if (['id', 'allowed_ips', 'endpoint'].includes(key)) {
                        // filter ExtJS specific data, that has purely
                        // informational purposes when selecting peers
                        continue;
                    }

                    peerData[key] = value;
                }

                peers.push(PVE.Parser.printPropertyString(peerData));
            }

            interfaces.push(PVE.Parser.printPropertyString(data));
        }

        if (interfaces.length > 0) {
            let retVal = {
                interfaces,
            };

            if (peers.length > 0) {
                retVal.peers = peers;
            } else if (me.getDeleteEmpty()) {
                retVal.delete = ['peers'];
            }

            return retVal;
        } else if (me.getDeleteEmpty()) {
            return {
                delete: ['interfaces', 'peers'],
            };
        }

        return null;
    },
});
