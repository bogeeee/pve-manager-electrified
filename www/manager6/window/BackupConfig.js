Ext.define('PVE.window.BackupConfig', {
    extend: 'Ext.window.Window',
    title: gettext('Configuration'),
    width: 600,
    height: 400,
    layout: 'fit',
    modal: true,
    items: {
        xtype: 'component',
        itemId: 'configtext',
        autoScroll: true,
        style: {
            'white-space': 'pre',
            'font-family': 'monospace',
            padding: '5px',
        },
    },

    initComponent: function () {
        var me = this;

        if (!me.volume) {
            throw 'no volume specified';
        }

        var nodename = me.pveSelNode.data.node;
        if (!nodename) {
            throw 'no node name specified';
        }

        me.callParent();

        Proxmox.Utils.API2Request({
            url: '/nodes/' + nodename + '/vzdump/extractconfig',
            method: 'GET',
            params: {
                volume: me.volume,
            },
            failure: function (response, opts) {
                me.close();
                Ext.Msg.alert('Error', response.htmlStatus);
            },
            success: function (response, options) {
                me.show();
                me.down('#configtext').update(Ext.htmlEncode(response.result.data));
            },
        });
    },
});
