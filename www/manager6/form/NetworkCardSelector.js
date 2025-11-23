Ext.define('PVE.form.NetworkCardSelector', {
    extend: 'Proxmox.form.KVComboBox',
    alias: 'widget.pveNetworkCardSelector',
    comboItems: [
        ['e1000', 'Intel E1000'],
        ['e1000e', 'Intel E1000E'],
        ['virtio', 'VirtIO (' + gettext('paravirtualized') + ')'],
        ['rtl8139', 'Realtek RTL8139'],
        ['vmxnet3', 'VMware vmxnet3'],
    ],
});
