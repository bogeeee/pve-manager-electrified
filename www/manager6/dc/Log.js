/* This class defines the "Cluster log" tab of the bottom status panel
 * A log entry is a timestamp associated with an action on a cluster
 */

Ext.define('PVE.dc.Log', {
    extend: 'Ext.grid.GridPanel',

    alias: ['widget.pveClusterLog'],

    initComponent: function () {
        let me = this;

        let logstore = Ext.create('Proxmox.data.UpdateStore', {
            storeid: 'pve-cluster-log',
            model: 'proxmox-cluster-log',
            proxy: {
                type: 'proxmox',
                url: '/api2/json/cluster/log',
            },
        });
        let store = Ext.create('Proxmox.data.DiffStore', {
            rstore: logstore,
            appendAtStart: true,
        });

        Ext.apply(me, {
            store: store,
            stateful: false,

            viewConfig: {
                trackOver: false,
                stripeRows: true,
                getRowClass: function (record, index) {
                    let pri = record.get('pri');
                    if (pri && pri <= 3) {
                        return 'proxmox-invalid-row';
                    }
                    return undefined;
                },
            },
            sortableColumns: false,
            columns: [
                {
                    header: gettext('Time'),
                    dataIndex: 'time',
                    width: 150,
                    renderer: function (value) {
                        return Ext.Date.format(value, 'M d H:i:s');
                    },
                },
                {
                    header: gettext('Node'),
                    dataIndex: 'node',
                    width: 150,
                },
                {
                    header: gettext('Service'),
                    dataIndex: 'tag',
                    width: 100,
                },
                {
                    header: 'PID',
                    dataIndex: 'pid',
                    width: 100,
                },
                {
                    header: gettext('User name'),
                    dataIndex: 'user',
                    renderer: Ext.String.htmlEncode,
                    width: 150,
                },
                {
                    header: gettext('Severity'),
                    dataIndex: 'pri',
                    renderer: PVE.Utils.render_serverity,
                    width: 100,
                },
                {
                    header: gettext('Message'),
                    dataIndex: 'msg',
                    renderer: Ext.String.htmlEncode,
                    flex: 1,
                },
            ],
            listeners: {
                activate: () => logstore.startUpdate(),
                deactivate: () => logstore.stopUpdate(),
                destroy: () => logstore.stopUpdate(),
            },
        });

        me.callParent();
    },
});
