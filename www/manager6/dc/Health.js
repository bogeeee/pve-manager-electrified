Ext.define('PVE.dc.Health', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveDcHealth',

    title: gettext('Health'),

    bodyPadding: 10,
    height: 250,
    layout: {
        type: 'hbox',
        align: 'stretch',
    },

    defaults: {
        flex: 1,
        xtype: 'box',
        style: {
            'text-align': 'center',
        },
    },

    nodeList: [],
    nodeIndex: 0,

    updateStatus: function (store, records, success) {
        let me = this;
        if (!success) {
            return;
        }

        let cluster = {
            iconCls: PVE.Utils.get_health_icon('good', true),
            text: gettext('Standalone node - no cluster defined'),
        };
        let nodes = {
            online: 0,
            offline: 0,
        };
        let numNodes = 1; // by default we have one node
        for (const { data } of records) {
            if (data.type === 'node') {
                nodes[data.online === 1 ? 'online' : 'offline']++;
            } else if (data.type === 'cluster') {
                cluster.text = `${gettext('Cluster')}: ${data.name}, ${gettext('Quorate')}: `;
                cluster.text += Proxmox.Utils.format_boolean(data.quorate);
                if (data.quorate !== 1) {
                    cluster.iconCls = PVE.Utils.get_health_icon('critical', true);
                }
                numNodes = data.nodes;
            }
        }

        if (numNodes !== nodes.online + nodes.offline) {
            nodes.offline = numNodes - nodes.online;
        }

        me.getComponent('clusterstatus').updateHealth(cluster);
        me.getComponent('nodestatus').update(nodes);
    },

    updateCeph: function (store, records, success) {
        let me = this;
        let cephstatus = me.getComponent('ceph');
        if (!success || records.length < 1) {
            if (cephstatus.isVisible()) {
                return; // if ceph status is already visible don't stop to update
            }
            // try all nodes until we either get a successful api call, or we tried all nodes
            if (++me.nodeIndex >= me.nodeList.length) {
                me.cephstore.stopUpdate();
            } else {
                store
                    .getProxy()
                    .setUrl(`/api2/json/nodes/${me.nodeList[me.nodeIndex].node}/ceph/status`);
            }
            return;
        }

        let state = PVE.Utils.render_ceph_health(records[0].data.health || {});
        cephstatus.updateHealth(state);
        cephstatus.setVisible(true);
    },

    listeners: {
        destroy: function () {
            let me = this;
            me.cephstore.stopUpdate();
        },
    },

    items: [
        {
            itemId: 'clusterstatus',
            xtype: 'pveHealthWidget',
            title: gettext('Status'),
        },
        {
            itemId: 'nodestatus',
            data: {
                online: 0,
                offline: 0,
            },
            tpl: [
                '<h3>' + gettext('Nodes') + '</h3><br />',
                '<div style="width: 150px;margin: auto;font-size: 12pt">',
                '<div class="left-aligned">',
                '<i class="good fa fa-fw fa-check">&nbsp;</i>',
                gettext('Online'),
                '</div>',
                '<div class="right-aligned">{online}</div>',
                '<br /><br />',
                '<div class="left-aligned">',
                '<i class="critical fa fa-fw fa-times">&nbsp;</i>',
                gettext('Offline'),
                '</div>',
                '<div class="right-aligned">{offline}</div>',
                '</div>',
            ],
        },
        {
            itemId: 'ceph',
            width: 250,
            columnWidth: undefined,
            userCls: 'pointer',
            title: 'Ceph',
            xtype: 'pveHealthWidget',
            hidden: true,
            listeners: {
                element: 'el',
                click: function () {
                    Ext.state.Manager.getProvider().set('dctab', { value: 'ceph' }, true);
                },
            },
        },
    ],

    initComponent: function () {
        let me = this;

        me.nodeList = PVE.data.ResourceStore.getNodes();
        me.nodeIndex = 0;
        me.cephstore = Ext.create('Proxmox.data.UpdateStore', {
            interval: 3000,
            storeid: 'pve-cluster-ceph',
            proxy: {
                type: 'proxmox',
                url: `/api2/json/nodes/${me.nodeList[me.nodeIndex].node}/ceph/status`,
            },
        });
        me.callParent();
        me.mon(me.cephstore, 'load', me.updateCeph, me);
        me.cephstore.startUpdate();
    },
});
