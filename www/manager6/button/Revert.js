Ext.define('PVE.button.PendingRevert', {
    extend: 'Proxmox.button.Button',
    alias: 'widget.pvePendingRevertButton',

    text: gettext('Revert'),
    disabled: true,
    config: {
        pendingGrid: null,
        apiurl: undefined,
    },

    handler: function () {
        if (!this.pendingGrid) {
            this.pendingGrid = this.up('proxmoxPendingObjectGrid');
            if (!this.pendingGrid) {
                throw 'revert button requires a pendingGrid';
            }
        }
        let view = this.pendingGrid;

        let rec = view.getSelectionModel().getSelection()[0];
        if (!rec) {
            return;
        }

        let rowdef = view.rows[rec.data.key] || {};
        let keys = rowdef.multiKey || [rec.data.key];

        Proxmox.Utils.API2Request({
            url: this.apiurl || view.editorConfig.url,
            waitMsgTarget: view,
            selModel: view.getSelectionModel(),
            method: 'PUT',
            params: {
                revert: keys.join(','),
            },
            callback: () => view.reload(),
            failure: (response) => Ext.Msg.alert('Error', response.htmlStatus),
        });
    },
});
