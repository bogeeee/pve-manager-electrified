Ext.define('pve-cluster-nodes', {
    extend: 'Ext.data.Model',
    fields: [
        'node',
        { type: 'integer', name: 'nodeid' },
        'ring0_addr',
        'ring1_addr',
        { type: 'integer', name: 'quorum_votes' },
    ],
    proxy: {
        type: 'proxmox',
        url: '/api2/json/cluster/config/nodes',
    },
    idProperty: 'nodeid',
});

Ext.define('pve-cluster-info', {
    extend: 'Ext.data.Model',
    proxy: {
        type: 'proxmox',
        url: '/api2/json/cluster/config/join',
    },
});

Ext.define('PVE.ClusterAdministration', {
    extend: 'Ext.panel.Panel',
    xtype: 'pveClusterAdministration',

    title: gettext('Cluster Administration'),
    onlineHelp: 'chapter_pvecm',

    border: false,
    defaults: { border: false },

    viewModel: {
        parent: null,
        data: {
            totem: {},
            nodelist: [],
            preferred_node: {
                name: '',
                fp: '',
                addr: '',
            },
            isInCluster: false,
            nodecount: 0,
        },
    },

    items: [
        {
            xtype: 'panel',
            title: gettext('Cluster Information'),
            controller: {
                xclass: 'Ext.app.ViewController',

                init: function (view) {
                    view.store = Ext.create('Proxmox.data.UpdateStore', {
                        autoStart: true,
                        interval: 15 * 1000,
                        storeid: 'pve-cluster-info',
                        model: 'pve-cluster-info',
                    });
                    view.store.on('load', this.onLoad, this);
                    view.on('destroy', view.store.stopUpdate);
                },

                onLoad: function (store, records, success, operation) {
                    let vm = this.getViewModel();

                    let data = records?.[0]?.data;
                    if (!success || !data || !data.nodelist?.length) {
                        let error = operation.getError();
                        if (error) {
                            let msg = Proxmox.Utils.getResponseErrorMessage(error);
                            if (error.status !== 424 && !msg.match(/node is not in a cluster/i)) {
                                // an actual error, not just the "not in a cluster one", so show it!
                                Proxmox.Utils.setErrorMask(this.getView(), msg);
                            }
                        }
                        vm.set('totem', {});
                        vm.set('isInCluster', false);
                        vm.set('nodelist', []);
                        vm.set('preferred_node', {
                            name: '',
                            addr: '',
                            fp: '',
                        });
                        return;
                    }
                    vm.set('totem', data.totem);
                    vm.set('isInCluster', !!data.totem.cluster_name);
                    vm.set('nodelist', data.nodelist);

                    let nodeinfo = data.nodelist.find((el) => el.name === data.preferred_node);

                    let links = {};
                    let ring_addr = [];
                    PVE.Utils.forEachCorosyncLink(nodeinfo, (num, link) => {
                        links[num] = link;
                        ring_addr.push(link);
                    });

                    vm.set('preferred_node', {
                        name: data.preferred_node,
                        addr: nodeinfo.pve_addr,
                        peerLinks: links,
                        ring_addr: ring_addr,
                        fp: nodeinfo.pve_fp,
                    });
                },

                onCreate: function () {
                    let view = this.getView();
                    view.store.stopUpdate();
                    Ext.create('PVE.ClusterCreateWindow', {
                        autoShow: true,
                        listeners: {
                            destroy: function () {
                                view.store.startUpdate();
                            },
                        },
                    });
                },

                onClusterInfo: function () {
                    let vm = this.getViewModel();
                    Ext.create('PVE.ClusterInfoWindow', {
                        autoShow: true,
                        joinInfo: {
                            ipAddress: vm.get('preferred_node.addr'),
                            fingerprint: vm.get('preferred_node.fp'),
                            peerLinks: vm.get('preferred_node.peerLinks'),
                            ring_addr: vm.get('preferred_node.ring_addr'),
                            totem: vm.get('totem'),
                        },
                    });
                },

                onJoin: function () {
                    let view = this.getView();
                    view.store.stopUpdate();
                    Ext.create('PVE.ClusterJoinNodeWindow', {
                        autoShow: true,
                        listeners: {
                            destroy: function () {
                                view.store.startUpdate();
                            },
                        },
                    });
                },
            },
            tbar: [
                {
                    text: gettext('Create Cluster'),
                    reference: 'createButton',
                    handler: 'onCreate',
                    bind: {
                        disabled: '{isInCluster}',
                    },
                },
                {
                    text: gettext('Join Information'),
                    reference: 'addButton',
                    handler: 'onClusterInfo',
                    bind: {
                        disabled: '{!isInCluster}',
                    },
                },
                {
                    text: gettext('Join Cluster'),
                    reference: 'joinButton',
                    handler: 'onJoin',
                    bind: {
                        disabled: '{isInCluster}',
                    },
                },
            ],
            layout: 'hbox',
            bodyPadding: 5,
            items: [
                {
                    xtype: 'displayfield',
                    fieldLabel: gettext('Cluster Name'),
                    bind: {
                        value: '{totem.cluster_name}',
                        hidden: '{!isInCluster}',
                    },
                    flex: 1,
                },
                {
                    xtype: 'displayfield',
                    fieldLabel: gettext('Config Version'),
                    bind: {
                        value: '{totem.config_version}',
                        hidden: '{!isInCluster}',
                    },
                    flex: 1,
                },
                {
                    xtype: 'displayfield',
                    fieldLabel: gettext('Number of Nodes'),
                    labelWidth: 120,
                    bind: {
                        value: '{nodecount}',
                        hidden: '{!isInCluster}',
                    },
                    flex: 1,
                },
                {
                    xtype: 'displayfield',
                    value: gettext('Standalone node - no cluster defined'),
                    bind: {
                        hidden: '{isInCluster}',
                    },
                    flex: 1,
                },
            ],
        },
        {
            xtype: 'grid',
            title: gettext('Cluster Nodes'),
            autoScroll: true,
            enableColumnHide: false,
            controller: {
                xclass: 'Ext.app.ViewController',

                init: function (view) {
                    view.rstore = Ext.create('Proxmox.data.UpdateStore', {
                        autoLoad: true,
                        xtype: 'update',
                        interval: 5 * 1000,
                        autoStart: true,
                        storeid: 'pve-cluster-nodes',
                        model: 'pve-cluster-nodes',
                    });
                    view.setStore(
                        Ext.create('Proxmox.data.DiffStore', {
                            rstore: view.rstore,
                            sorters: {
                                property: 'nodeid',
                                direction: 'ASC',
                            },
                        }),
                    );
                    Proxmox.Utils.monStoreErrors(view, view.rstore);
                    view.rstore.on('load', this.onLoad, this);
                    view.on('destroy', view.rstore.stopUpdate);
                },

                onLoad: function (store, records, success) {
                    let view = this.getView();
                    let vm = this.getViewModel();

                    if (!success || !records || !records.length) {
                        vm.set('nodecount', 0);
                        return;
                    }
                    vm.set('nodecount', records.length);

                    // show/hide columns according to used links
                    let linkIndex = view.columns.length;
                    Ext.each(view.columns, (col, i) => {
                        if (col.linkNumber !== undefined) {
                            col.setHidden(true);
                            // save offset at which link columns start, so we can address them directly below
                            if (i < linkIndex) {
                                linkIndex = i;
                            }
                        }
                    });

                    PVE.Utils.forEachCorosyncLink(records[0].data, (linknum, val) => {
                        if (linknum > 7) {
                            return;
                        }
                        view.columns[linkIndex + linknum].setHidden(false);
                    });
                },
            },
            columns: {
                items: [
                    {
                        header: gettext('Nodename'),
                        hidden: false,
                        dataIndex: 'name',
                    },
                    {
                        header: gettext('ID'),
                        minWidth: 100,
                        width: 100,
                        flex: 0,
                        hidden: false,
                        dataIndex: 'nodeid',
                    },
                    {
                        header: gettext('Votes'),
                        minWidth: 100,
                        width: 100,
                        flex: 0,
                        hidden: false,
                        dataIndex: 'quorum_votes',
                    },
                    {
                        header: Ext.String.format(gettext('Link {0}'), 0),
                        dataIndex: 'ring0_addr',
                        linkNumber: 0,
                    },
                    {
                        header: Ext.String.format(gettext('Link {0}'), 1),
                        dataIndex: 'ring1_addr',
                        linkNumber: 1,
                    },
                    {
                        header: Ext.String.format(gettext('Link {0}'), 2),
                        dataIndex: 'ring2_addr',
                        linkNumber: 2,
                    },
                    {
                        header: Ext.String.format(gettext('Link {0}'), 3),
                        dataIndex: 'ring3_addr',
                        linkNumber: 3,
                    },
                    {
                        header: Ext.String.format(gettext('Link {0}'), 4),
                        dataIndex: 'ring4_addr',
                        linkNumber: 4,
                    },
                    {
                        header: Ext.String.format(gettext('Link {0}'), 5),
                        dataIndex: 'ring5_addr',
                        linkNumber: 5,
                    },
                    {
                        header: Ext.String.format(gettext('Link {0}'), 6),
                        dataIndex: 'ring6_addr',
                        linkNumber: 6,
                    },
                    {
                        header: Ext.String.format(gettext('Link {0}'), 7),
                        dataIndex: 'ring7_addr',
                        linkNumber: 7,
                    },
                ],
                defaults: {
                    flex: 1,
                    hidden: true,
                    minWidth: 150,
                },
            },
        },
    ],
});
